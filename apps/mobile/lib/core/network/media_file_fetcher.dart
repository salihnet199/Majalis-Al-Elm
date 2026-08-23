import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constants/app_constants.dart';
import 'error_handler.dart';

/// Downloads the bytes of a presigned media URL.
///
/// It deliberately does NOT use [ApiClient]. Two reasons, both load-bearing:
///
///   * A presigned URL is absolute and points at the storage provider, not at our
///     API, so the client's `baseUrl` is wrong for it.
///   * The URL already carries its own SigV4 signature in the query string. S3
///     and R2 reject a request that also presents an `Authorization` header
///     ("only one auth mechanism allowed"), which is exactly what our
///     `AuthInterceptor` would attach.
///
/// This class replaces `InternetAddressCustomLoader`, which was declared in
/// `pdf_viewer_screen.dart` and returned `Uint8List(0)` for every URL. Every
/// remote PDF therefore opened as a zero-byte document: the viewer reported
/// success for a file it had never fetched — POLICY-SEC-001 category 3
/// (see docs/governance/TECHNICAL_DEBT.md).
class MediaFileFetcher {
  final Dio _dio;

  MediaFileFetcher({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: AppConstants.connectTimeout,
                // A book-sized PDF over a slow connection needs more than the
                // 15s the JSON API uses.
                receiveTimeout: const Duration(minutes: 3),
              ),
            );

  /// Returns the file's bytes, or throws [AppException] with an Arabic message.
  ///
  /// [onProgress] receives `total == -1` when the response carries no
  /// `Content-Length`; callers must treat that as "unknown", never as zero.
  Future<Uint8List> fetch(
    String url, {
    void Function(int received, int total)? onProgress,
  }) async {
    try {
      final response = await _dio.get<List<int>>(
        url,
        options: Options(responseType: ResponseType.bytes),
        onReceiveProgress: onProgress,
      );

      final body = response.data;
      if (body == null || body.isEmpty) {
        // A 200 with no body is not a document. Returning empty bytes here is
        // what made the old loader look like it worked.
        throw const AppException(
          code: 'MEDIA_EMPTY_RESPONSE',
          message: 'وصل الملف فارغاً من المخزن، يرجى إعادة المحاولة',
        );
      }

      return Uint8List.fromList(body);
    } on DioException catch (e) {
      // The storage provider answers XML, not our error envelope, so its body is
      // not shown to the user; the status is what matters.
      final status = e.response?.statusCode;
      if (status == 403) {
        throw const AppException(
          code: 'MEDIA_URL_EXPIRED',
          message: 'انتهت صلاحية رابط الملف، يرجى إعادة المحاولة',
        );
      }
      if (status == 404) {
        throw const AppException(
          code: 'MEDIA_NOT_FOUND',
          message: 'الملف غير موجود في المخزن',
        );
      }
      throw AppException.fromDioException(
        e,
        fallbackMessage: 'تعذر تنزيل الملف من المخزن، يرجى المحاولة لاحقاً',
      );
    }
  }
}

final mediaFileFetcherProvider = Provider<MediaFileFetcher>((ref) {
  return MediaFileFetcher();
});
