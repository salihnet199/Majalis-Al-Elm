import { AxiosError } from 'axios';

/**
 * Maps an API / network failure to a clear Arabic message for the admin UI.
 *
 * GOVERNANCE RULE — see docs/governance/TECHNICAL_DEBT.md (POLICY-SEC-001):
 * a failed request must surface as a visible error. Never substitute fabricated
 * data, a fabricated session, or a fabricated success toast for a real failure —
 * that hides outages and has already produced two auth bypasses in this codebase.
 */
export const toArabicErrorMessage = (
  error: unknown,
  fallback = 'تعذر تنفيذ العملية، يرجى المحاولة مرة أخرى',
): string => {
  const axiosError = error as AxiosError<{ error?: { code?: string; message?: string } }>;

  const response = axiosError?.response;
  if (response) {
    const apiMessage = response.data?.error?.message;
    if (apiMessage) return apiMessage;

    switch (response.status) {
      case 400:
      case 422:
        return 'البيانات المُرسلة غير صحيحة، يرجى التحقق من الحقول';
      case 401:
        return 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً';
      case 403:
        return 'ليست لديك الصلاحية اللازمة لتنفيذ هذه العملية';
      case 404:
        return 'العنصر المطلوب غير موجود على الخادم';
      case 409:
        return 'تعارض في البيانات: العنصر مسجَّل مسبقاً';
      case 429:
        return 'تم تجاوز الحد المسموح من الطلبات، يرجى الانتظار قليلاً';
      default:
        if (response.status >= 500) {
          return 'خطأ في الخادم، يرجى المحاولة لاحقاً أو مراجعة سجلات النظام';
        }
        return fallback;
    }
  }

  if (axiosError?.code === 'ECONNABORTED' || axiosError?.code === 'ETIMEDOUT') {
    return 'انتهت مدة انتظار الخادم دون استجابة، يرجى المحاولة مرة أخرى';
  }

  if (axiosError?.code === 'ERR_NETWORK' || axiosError?.request) {
    return 'تعذر الاتصال بالخادم، يرجى التحقق من الشبكة ومن أن الخدمة تعمل';
  }

  return fallback;
};
