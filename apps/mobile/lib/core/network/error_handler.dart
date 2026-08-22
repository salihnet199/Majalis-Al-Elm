import 'api_response.dart';

class AppException implements Exception {
  final String message;
  final String code;
  final String? traceId;

  const AppException({
    required this.message,
    required this.code,
    this.traceId,
  });

  factory AppException.fromApiError(ApiError error) {
    return AppException(
      message: _mapErrorCodeToMessage(error.code, error.message),
      code: error.code,
      traceId: error.traceId,
    );
  }

  static String _mapErrorCodeToMessage(String code, String fallbackMessage) {
    switch (code) {
      case 'AUTH_INVALID_CREDENTIALS':
        return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
      case 'AUTH_EMAIL_TAKEN':
      case 'CONFLICT':
        return 'هذا البريد الإلكتروني مسجل مسبقاً';
      case 'AUTH_TOKEN_EXPIRED':
        return 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً';
      case 'AUTH_ACCOUNT_SUSPENDED':
        return 'تم إيقاف هذا الحساب، يرجى التواصل مع الإدارة';
      case 'VALIDATION_ERROR':
        return 'يرجى التحقق من صحة البيانات المدخلة';
      case 'RATE_LIMITED':
        return 'تم تجاوز الحد المسموح من المحاولات، يرجى الانتظار قليلاً';
      case 'NOT_FOUND':
        return 'المحتوى المطلوب غير موجود';
      case 'FORBIDDEN':
        return 'ليس لديك صلاحية للوصول إلى هذا المحتوى';
      case 'MAINTENANCE_MODE':
        return 'النظام في وضع الصيانة المجدولة، سنعود قريباً';
      default:
        return fallbackMessage.isNotEmpty ? fallbackMessage : 'حدث خطأ في الاتصال بالخادم';
    }
  }

  @override
  String toString() => message;
}
