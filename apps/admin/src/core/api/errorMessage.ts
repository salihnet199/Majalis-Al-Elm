import { AxiosError } from 'axios';

/**
 * Maps an API / network failure to a clear Arabic message for the admin UI.
 *
 * GOVERNANCE RULE — see docs/governance/TECHNICAL_DEBT.md (POLICY-SEC-001):
 * a failed request must surface as a visible error. Never substitute fabricated
 * data, a fabricated session, or a fabricated success toast for a real failure —
 * that hides outages and has already produced two auth bypasses in this codebase.
 */

/**
 * Arabic text for the error codes the API emits, keyed by the `error.code` of the
 * canonical envelope (`{ error: { code, message, trace_id } }`).
 *
 * This map is consulted BEFORE `error.message`, because the server's messages are
 * English and written for an operator ("Declared 8 parts, received 7"). Falling
 * straight through to them put English into an Arabic RTL interface at exactly the
 * moments an editor most needs to understand what happened.
 *
 * Codes that carry a specific diagnostic in `message` (the upload verification
 * failures) get an Arabic prefix here and keep the server's detail appended, so
 * nothing the server took the trouble to measure is discarded.
 */
const CODE_MESSAGES_AR: Record<string, string> = {
  // ── Auth / access ──────────────────────────────────────────────────────────
  UNAUTHENTICATED: 'الجلسة غير موثّقة، يرجى تسجيل الدخول مجدداً',
  AUTH_MISSING_TOKEN: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً',
  AUTH_TOKEN_EXPIRED: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً',
  FORBIDDEN: 'ليست لديك الصلاحية اللازمة لتنفيذ هذه العملية',

  // ── Generic ────────────────────────────────────────────────────────────────
  VALIDATION_ERROR: 'البيانات المُرسلة غير صحيحة، يرجى التحقق من الحقول',
  NOT_FOUND: 'العنصر المطلوب غير موجود على الخادم',
  CONFLICT: 'تعارض في البيانات: العنصر مسجَّل مسبقاً',
  UNPROCESSABLE: 'العملية غير ممكنة في الحالة الحالية للمادة',
  RATE_LIMITED: 'تم تجاوز الحد المسموح من الطلبات، يرجى الانتظار قليلاً',
  MAINTENANCE_MODE: 'الخدمة في وضع الصيانة حالياً',

  // ── Media upload (ADR-013 Stage A) ─────────────────────────────────────────
  UNSUPPORTED_MEDIA_TYPE: 'نوع الملف غير مسموح به',
  FILE_TOO_LARGE: 'حجم الملف يتجاوز الحد المسموح',
  MULTIPART_PARTS_REQUIRED: 'رفع الملف على أجزاء غير مكتمل: لم تُرسل معرّفات كل الأجزاء',
  UPLOAD_ABORTED: 'عملية الرفع أُلغيت سابقاً، ابدأ رفعاً جديداً',
  UPLOAD_INCOMPLETE: 'الرفع غير مكتمل',
  UPLOAD_NOT_FOUND_IN_STORAGE: 'لم يُعثر على الملف في التخزين، لذلك لم يُعتمد الرفع',
  UPLOAD_SIZE_MISMATCH: 'حجم الملف في التخزين لا يطابق الحجم المُعلن',
  UPLOAD_CHECKSUM_MISMATCH: 'بصمة الملف (SHA-256) في التخزين لا تطابق البصمة المُعلنة',
  MEDIA_NOT_AVAILABLE: 'الملف غير متاح: لا توجد نسخة مُتحقَّق منها في التخزين',
};

/**
 * Codes whose server-side `message` is a measurement worth showing (byte counts,
 * part counts, digests). For these the Arabic label above is a prefix, not a
 * replacement.
 */
const CODES_WITH_USEFUL_DETAIL = new Set([
  'UPLOAD_INCOMPLETE',
  'UPLOAD_SIZE_MISMATCH',
  'UPLOAD_CHECKSUM_MISMATCH',
  'MULTIPART_PARTS_REQUIRED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE',
]);

/** Heuristic: is this text Arabic already? Server messages are English. */
const looksArabic = (text: string): boolean => /[؀-ۿ]/.test(text);

export const toArabicErrorMessage = (
  error: unknown,
  fallback = 'تعذر تنفيذ العملية، يرجى المحاولة مرة أخرى',
): string => {
  const axiosError = error as AxiosError<{ error?: { code?: string; message?: string } }>;

  const response = axiosError?.response;
  if (response) {
    const apiCode = response.data?.error?.code;
    const apiMessage = response.data?.error?.message;

    const mapped = apiCode ? CODE_MESSAGES_AR[apiCode] : undefined;
    if (mapped) {
      return apiMessage && CODES_WITH_USEFUL_DETAIL.has(apiCode as string)
        ? `${mapped} — ${apiMessage}`
        : mapped;
    }

    // An unmapped code with an Arabic message is a deliberate Arabic message from
    // the API; show it as-is. An English one is shown only when nothing better
    // exists, since hiding it entirely would hide the diagnostic too.
    if (apiMessage && looksArabic(apiMessage)) return apiMessage;

    switch (response.status) {
      case 400:
      case 422:
        return apiMessage
          ? `البيانات المُرسلة غير صحيحة: ${apiMessage}`
          : 'البيانات المُرسلة غير صحيحة، يرجى التحقق من الحقول';
      case 401:
        return 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً';
      case 403:
        return 'ليست لديك الصلاحية اللازمة لتنفيذ هذه العملية';
      case 404:
        return 'العنصر المطلوب غير موجود على الخادم';
      case 409:
        return apiMessage ? `تعارض في البيانات: ${apiMessage}` : 'تعارض في البيانات: العنصر مسجَّل مسبقاً';
      case 429:
        return 'تم تجاوز الحد المسموح من الطلبات، يرجى الانتظار قليلاً';
      default:
        if (response.status >= 500) {
          return 'خطأ في الخادم، يرجى المحاولة لاحقاً أو مراجعة سجلات النظام';
        }
        return apiMessage || fallback;
    }
  }

  if (axiosError?.code === 'ECONNABORTED' || axiosError?.code === 'ETIMEDOUT') {
    return 'انتهت مدة انتظار الخادم دون استجابة، يرجى المحاولة مرة أخرى';
  }

  if (axiosError?.code === 'ERR_NETWORK' || axiosError?.request) {
    return 'تعذر الاتصال بالخادم، يرجى التحقق من الشبكة ومن أن الخدمة تعمل';
  }

  // A plain Error thrown by our own code (e.g. "الخادم لم يُعِد معرّف المادة")
  // already carries an Arabic, user-facing sentence — losing it to the generic
  // fallback would turn a precise report into a shrug.
  if (error instanceof Error && error.message && looksArabic(error.message)) {
    return error.message;
  }

  return fallback;
};
