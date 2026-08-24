/**
 * BulkUploadQueue — Browser-side upload orchestrator (البند ج)
 *
 * Manages concurrent uploads of many files without touching the existing
 * `uploadMediaFile()` function at all — it wraps it, never replaces it.
 *
 * Invariants:
 *  - CONCURRENT_UPLOADS = 3: three slots in flight, the rest wait as QUEUED.
 *  - Each file progresses through: QUEUED → HASHING → UPLOADING → VERIFYING → DONE
 *    On any error it lands in FAILED with a human-readable reason, retryable.
 *  - localStorage checkpoint: stores { id, fileName, mediaAssetId } for DONE items.
 *    File objects are NOT serialised (not serialisable); only metadata is persisted.
 *    After a page refresh, the UI can show which files succeeded and which need
 *    re-selection — no silent restart of an already-completed upload.
 *  - AbortController per item: pausing all or retrying one are both cheap cancels.
 */

import { uploadMediaFile, UploadProgress } from './mediaUpload';

// ── Types ────────────────────────────────────────────────────────────────────

export type BulkItemStatus =
  | 'QUEUED'
  | 'HASHING'
  | 'UPLOADING'
  | 'VERIFYING'
  | 'DONE'
  | 'FAILED';

export interface BulkItem {
  /** Stable local UUID for React keys and localStorage. */
  id: string;
  file: File;
  status: BulkItemStatus;
  /** Live progress from uploadMediaFile — null when not yet started or done. */
  progress: UploadProgress | null;
  /** Set only when status === 'DONE'. */
  mediaAssetId?: string;
  /** Set only when status === 'FAILED'. */
  error?: string;
  retryCount: number;
}

/** What we persist to localStorage — File objects omitted (not serialisable). */
interface CheckpointEntry {
  id: string;
  fileName: string;
  mediaAssetId: string;
  completedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONCURRENT_UPLOADS = 3;
const CHECKPOINT_KEY = 'bulk_upload_checkpoint_v1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadCheckpoint(): CheckpointEntry[] {
  try {
    return JSON.parse(localStorage.getItem(CHECKPOINT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveCheckpoint(entry: CheckpointEntry): void {
  try {
    const existing = loadCheckpoint();
    // Cap at 500 entries to avoid unbounded growth.
    const updated = [...existing.filter((e) => e.id !== entry.id), entry].slice(-500);
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(updated));
  } catch {
    // localStorage quota exceeded or private mode — silently skip, not a critical path.
  }
}

export function clearCheckpoint(): void {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch {
    // ignore
  }
}

// ── BulkUploadQueue ───────────────────────────────────────────────────────────

type Listener = (items: BulkItem[]) => void;

export class BulkUploadQueue {
  private _items: BulkItem[] = [];
  private _abortControllers = new Map<string, AbortController>();
  private _listeners = new Set<Listener>();
  private _paused = false;

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    listener([...this._items]);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    const snapshot = [...this._items];
    this._listeners.forEach((l) => l(snapshot));
  }

  // ── Mutation helpers ──────────────────────────────────────────────────────

  private _update(id: string, patch: Partial<BulkItem>): void {
    this._items = this._items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    this._notify();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Snapshot of the current queue — use for one-off reads, not rendering. */
  get items(): BulkItem[] {
    return [...this._items];
  }

  /**
   * Adds files to the queue and immediately starts uploading up to the
   * concurrent limit. Duplicate files (same name + size + lastModified) are
   * silently skipped — re-adding already-DONE files is a no-op.
   */
  enqueue(files: File[]): void {
    const newItems: BulkItem[] = [];

    for (const file of files) {
      // Skip files that are already DONE or in-progress by identity check.
      const alreadyPresent = this._items.some(
        (item) =>
          item.file.name === file.name &&
          item.file.size === file.size &&
          item.file.lastModified === file.lastModified &&
          item.status !== 'FAILED',
      );
      if (alreadyPresent) continue;

      newItems.push({
        id: generateId(),
        file,
        status: 'QUEUED',
        progress: null,
        retryCount: 0,
      });
    }

    if (newItems.length === 0) return;

    this._items = [...this._items, ...newItems];
    this._notify();
    this._drain();
  }

  /** Retry a single FAILED item — resets it to QUEUED and restarts. */
  retry(id: string): void {
    const item = this._items.find((i) => i.id === id);
    if (!item || item.status !== 'FAILED') return;

    this._update(id, { status: 'QUEUED', error: undefined, progress: null });
    this._drain();
  }

  /** Cancel a specific in-progress item and mark it FAILED. */
  cancel(id: string): void {
    this._abortControllers.get(id)?.abort();
    this._abortControllers.delete(id);
    this._update(id, {
      status: 'FAILED',
      error: 'أُلغي الرفع يدوياً',
      progress: null,
    });
  }

  /** Pause: stop starting new uploads; in-flight ones continue until done. */
  pause(): void {
    this._paused = true;
  }

  /** Resume: restart the drain loop to fill empty slots. */
  resume(): void {
    this._paused = false;
    this._drain();
  }

  /** Cancel all in-progress items and pause. Does not clear the list. */
  pauseAll(): void {
    this._paused = true;
    for (const [id, ctrl] of this._abortControllers) {
      ctrl.abort();
      this._update(id, { status: 'FAILED', error: 'أُوقف الرفع', progress: null });
    }
    this._abortControllers.clear();
  }

  /** Retry all FAILED items at once. */
  retryAllFailed(): void {
    const failedIds = this._items.filter((i) => i.status === 'FAILED').map((i) => i.id);
    for (const id of failedIds) {
      this._update(id, { status: 'QUEUED', error: undefined, progress: null });
    }
    this._paused = false;
    this._drain();
  }

  /** Remove DONE and FAILED items from the list. In-progress items stay. */
  clearCompleted(): void {
    this._items = this._items.filter(
      (i) => i.status !== 'DONE' && i.status !== 'FAILED',
    );
    this._notify();
  }

  // ── Drain loop ────────────────────────────────────────────────────────────

  /**
   * Fills upload slots up to CONCURRENT_UPLOADS.
   * Called after any state change that might free a slot or add queued items.
   */
  private _drain(): void {
    if (this._paused) return;

    const inFlight = this._items.filter(
      (i) => i.status === 'HASHING' || i.status === 'UPLOADING' || i.status === 'VERIFYING',
    ).length;

    const slotsAvailable = CONCURRENT_UPLOADS - inFlight;
    if (slotsAvailable <= 0) return;

    const queued = this._items.filter((i) => i.status === 'QUEUED').slice(0, slotsAvailable);
    for (const item of queued) {
      this._startItem(item.id);
    }
  }

  private async _startItem(id: string): Promise<void> {
    const item = this._items.find((i) => i.id === id);
    if (!item || item.status !== 'QUEUED') return;

    const controller = new AbortController();
    this._abortControllers.set(id, controller);

    try {
      const result = await uploadMediaFile({
        file: item.file,
        signal: controller.signal,
        onProgress: (progress) => {
          // Map the upload phase to our status.
          const status: BulkItemStatus =
            progress.phase === 'HASHING'
              ? 'HASHING'
              : progress.phase === 'VERIFYING'
                ? 'VERIFYING'
                : 'UPLOADING';
          this._update(id, { status, progress });
        },
      });

      // Persist before updating state so a listener always sees a saved entry.
      saveCheckpoint({
        id,
        fileName: item.file.name,
        mediaAssetId: result.mediaAssetId,
        completedAt: new Date().toISOString(),
      });

      this._update(id, {
        status: 'DONE',
        progress: null,
        mediaAssetId: result.mediaAssetId,
      });
    } catch (err: unknown) {
      const isAbort =
        controller.signal.aborted ||
        (err instanceof Error && err.message.includes('إلغاء'));

      this._update(id, {
        status: 'FAILED',
        progress: null,
        retryCount: (item.retryCount ?? 0) + 1,
        error: isAbort
          ? 'أُلغي الرفع'
          : err instanceof Error
            ? err.message
            : 'فشل الرفع بسبب غير معروف',
      });
    } finally {
      this._abortControllers.delete(id);
      // Always try to fill the freed slot.
      this._drain();
    }
  }

  // ── Checkpoint query ──────────────────────────────────────────────────────

  /** Returns persisted checkpoint entries for display after a page reload. */
  static getCheckpointEntries(): CheckpointEntry[] {
    return loadCheckpoint();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// One queue per browser tab — React context wraps it for component access.
export const bulkUploadQueue = new BulkUploadQueue();
