class ApiResponse<T> {
  final T? data;
  final ApiMeta? meta;
  final ApiError? error;

  const ApiResponse({
    this.data,
    this.meta,
    this.error,
  });

  bool get isSuccess => error == null;
  bool get isError => error != null;

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(dynamic dataJson) fromJsonT,
  ) {
    if (json.containsKey('error') && json['error'] != null) {
      return ApiResponse<T>(
        error: ApiError.fromJson(json['error'] as Map<String, dynamic>),
      );
    }

    return ApiResponse<T>(
      data: json['data'] != null ? fromJsonT(json['data']) : null,
      meta: json['meta'] != null
          ? ApiMeta.fromJson(json['meta'] as Map<String, dynamic>)
          : null,
    );
  }
}

class ApiMeta {
  final int? total;
  final int? limit;
  final String? nextCursor;
  final String? prevCursor;
  final int? page;
  final int? totalPages;

  const ApiMeta({
    this.total,
    this.limit,
    this.nextCursor,
    this.prevCursor,
    this.page,
    this.totalPages,
  });

  factory ApiMeta.fromJson(Map<String, dynamic> json) {
    return ApiMeta(
      total: json['total'] as int?,
      limit: json['limit'] as int?,
      nextCursor: json['nextCursor'] as String?,
      prevCursor: json['prevCursor'] as String?,
      page: json['page'] as int?,
      totalPages: json['totalPages'] as int?,
    );
  }
}

class ApiError {
  final String code;
  final String message;
  final List<dynamic>? details;
  final String? traceId;

  const ApiError({
    required this.code,
    required this.message,
    this.details,
    this.traceId,
  });

  factory ApiError.fromJson(Map<String, dynamic> json) {
    return ApiError(
      code: json['code'] as String? ?? 'UNKNOWN_ERROR',
      message: json['message'] as String? ?? 'حدث خطأ غير متوقع',
      details: json['details'] as List<dynamic>?,
      traceId: json['trace_id'] as String?,
    );
  }

  @override
  String toString() => 'ApiError(code: $code, message: $message, traceId: $traceId)';
}
