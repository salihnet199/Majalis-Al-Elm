import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Drawer,
  Button,
  Typography,
  Space,
  Divider,
  Badge,
  Tooltip,
  Alert,
} from 'antd';
import {
  UploadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ClearOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import {
  bulkUploadQueue,
  BulkItem,
  BulkUploadQueue,
  CONCURRENT_UPLOADS,
} from '../../core/api/bulkUploadQueue';
import { acceptAttributeForContentType } from '../../core/api/mediaUpload';
import { BulkUploadProgressTable } from './BulkUploadProgressTable';

const { Title, Text } = Typography;

// ── Derived stats ──────────────────────────────────────────────────────────────

interface QueueStats {
  total: number;
  done: number;
  failed: number;
  inProgress: number;
  queued: number;
}

function computeStats(items: BulkItem[]): QueueStats {
  return {
    total: items.length,
    done: items.filter((i) => i.status === 'DONE').length,
    failed: items.filter((i) => i.status === 'FAILED').length,
    inProgress: items.filter(
      (i) => i.status === 'HASHING' || i.status === 'UPLOADING' || i.status === 'VERIFYING',
    ).length,
    queued: items.filter((i) => i.status === 'QUEUED').length,
  };
}

// ── Drag-and-drop zone styles ─────────────────────────────────────────────────

const DROP_ZONE_BASE =
  'border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 cursor-pointer';
const DROP_ZONE_IDLE = `${DROP_ZONE_BASE} border-slate-600 hover:border-emerald-500 bg-slate-800/40 hover:bg-emerald-900/10`;
const DROP_ZONE_ACTIVE = `${DROP_ZONE_BASE} border-emerald-400 bg-emerald-900/20`;

// ── Props ─────────────────────────────────────────────────────────────────────

interface BulkUploadDrawerProps {
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const BulkUploadDrawer: React.FC<BulkUploadDrawerProps> = ({
  open,
  onClose,
}) => {
  const [items, setItems] = useState<BulkItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to the singleton queue.
  useEffect(() => {
    const unsub = bulkUploadQueue.subscribe((snapshot) => setItems(snapshot));
    return unsub;
  }, []);

  const stats = computeStats(items);

  // ── File selection handlers ────────────────────────────────────────────────

  const handleFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    bulkUploadQueue.enqueue(arr);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    // Reset so the same files can be re-added after a retry.
    e.target.value = '';
  };

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);

    // Support dropping an entire directory (webkit).
    const filesFromDrop: File[] = [];
    const items = Array.from(e.dataTransfer.items ?? []);

    if (items.length > 0) {
      // DataTransferItemList path — supports webkitGetAsEntry for directories.
      const entries = items
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean) as FileSystemEntry[];
      collectEntries(entries, filesFromDrop).then(() =>
        handleFiles(filesFromDrop),
      );
    } else if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // ── Pause / resume ─────────────────────────────────────────────────────────

  const togglePause = () => {
    if (paused) {
      bulkUploadQueue.resume();
      setPaused(false);
    } else {
      bulkUploadQueue.pause();
      setPaused(true);
    }
  };

  const handleRetryAllFailed = () => {
    bulkUploadQueue.retryAllFailed();
    setPaused(false);
  };

  // ── Checkpoint display ─────────────────────────────────────────────────────

  const checkpointEntries = BulkUploadQueue.getCheckpointEntries();
  const previousSessionDone = checkpointEntries.filter(
    (e) => !items.some((i) => i.id === e.id),
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Drawer
      title={
        <Space>
          <UploadOutlined className="text-emerald-400" />
          <Title level={5} className="!text-slate-100 !mb-0">
            رفع بالجملة
          </Title>
          {stats.total > 0 && (
            <Badge
              count={`${stats.done}/${stats.total}`}
              style={{ backgroundColor: stats.failed > 0 ? '#cf1322' : '#52c41a' }}
            />
          )}
        </Space>
      }
      placement="right"
      width={680}
      open={open}
      onClose={onClose}
      styles={{
        body: { padding: '16px', background: '#0f172a' },
        header: { background: '#1e293b', borderBottom: '1px solid #334155' },
      }}
      footer={
        stats.total > 0 ? (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Space wrap>
              <Button
                id="bulk-toggle-pause"
                icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                onClick={togglePause}
                disabled={stats.inProgress === 0 && stats.queued === 0 && !paused}
              >
                {paused ? 'استئناف' : 'إيقاف مؤقت'}
              </Button>
              {stats.failed > 0 && (
                <Button
                  id="bulk-retry-all"
                  icon={<ReloadOutlined />}
                  onClick={handleRetryAllFailed}
                  className="text-emerald-400 border-emerald-700"
                >
                  إعادة المحاولة ({stats.failed} ملف)
                </Button>
              )}
              <Button
                id="bulk-clear-completed"
                icon={<ClearOutlined />}
                onClick={() => bulkUploadQueue.clearCompleted()}
                disabled={stats.done === 0 && stats.failed === 0}
              >
                إخفاء المكتملة
              </Button>
            </Space>
            <Text className="text-slate-400 text-xs">
              {stats.inProgress} يُرفع الآن · {stats.queued} في الانتظار · {CONCURRENT_UPLOADS} مسارات متزامنة
            </Text>
          </div>
        ) : null
      }
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptAttributeForContentType('')}
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error -- non-standard but widely supported
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div className="space-y-4">
        {/* Drop zone */}
        <div
          id="bulk-drop-zone"
          className={dragging ? DROP_ZONE_ACTIVE : DROP_ZONE_IDLE}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadOutlined className="text-3xl text-slate-400 mb-2 block" />
          <div className="font-bold text-slate-300 mb-1">
            اسحب الملفات هنا، أو اضغط لاختيار ملفات
          </div>
          <div className="text-slate-500 text-xs mb-3">
            MP3 · M4A · AAC (حد 300MB) · PDF (100MB) · صور (10MB)
          </div>
          <Space>
            <Button
              id="bulk-select-files"
              icon={<UploadOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              اختر ملفات
            </Button>
            <Tooltip title="اختر مجلداً كاملاً (مدعوم في Chrome/Edge)">
              <Button
                id="bulk-select-folder"
                icon={<FolderOpenOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
              >
                اختر مجلداً
              </Button>
            </Tooltip>
          </Space>
        </div>

        {/* Progress table */}
        {items.length > 0 && (
          <>
            <Divider className="border-slate-700 !my-3" />
            <BulkUploadProgressTable
              items={items}
              onRetry={(id) => bulkUploadQueue.retry(id)}
              onCancel={(id) => bulkUploadQueue.cancel(id)}
            />
          </>
        )}

        {/* localStorage checkpoint — previous session */}
        {previousSessionDone.length > 0 && items.length === 0 && (
          <>
            <Divider className="border-slate-700 !my-3" />
            <Alert
              type="info"
              showIcon
              className="rounded-xl"
              message={
                <span className="text-xs font-bold">
                  {previousSessionDone.length} ملف رُفع بنجاح في جلسة سابقة
                </span>
              }
              description={
                <div className="text-xs text-slate-400 mt-1 space-y-1 max-h-32 overflow-y-auto">
                  {previousSessionDone.slice(-10).map((e) => (
                    <div key={e.id} className="font-mono">
                      ✅ {e.fileName}
                    </div>
                  ))}
                  {previousSessionDone.length > 10 && (
                    <div className="text-slate-500">
                      … و {previousSessionDone.length - 10} آخرين
                    </div>
                  )}
                </div>
              }
            />
          </>
        )}
      </div>
    </Drawer>
  );
};

// ── Directory traversal helper ────────────────────────────────────────────────

async function collectEntries(
  entries: FileSystemEntry[],
  result: File[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      result.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      await collectEntries(children, result);
    }
  }
}
