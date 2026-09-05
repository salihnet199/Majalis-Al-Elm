import 'package:dio/dio.dart';
import '../constants/api_endpoints.dart';
import '../storage/secure_storage_service.dart';

class AuthInterceptor extends QueuedInterceptor {
  final Dio dio;
  final SecureStorageService secureStorage;
  final void Function()? onSessionExpired;

  AuthInterceptor({
    required this.dio,
    required this.secureStorage,
    this.onSessionExpired,
  });

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Add token if not an unauthenticated endpoint
    final isAuthEndpoint = options.path.contains('/auth/login') ||
        options.path.contains('/auth/register') ||
        options.path.contains('/auth/token/refresh');

    if (!isAuthEndpoint) {
      final token = await secureStorage.getAccessToken();
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }

    options.headers['Content-Type'] = 'application/json; charset=utf-8';
    options.headers['Accept'] = 'application/json; charset=utf-8';

    return handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode != 401) {
      return handler.next(err);
    }

    final isRefreshEndpoint = err.requestOptions.path.contains(ApiEndpoints.refreshToken);
    final alreadyRetried = err.requestOptions.extra['auth_retry'] == true;

    // Never refresh the refresh request itself, and never retry the same
    // protected request more than once. This prevents an endless 401 ->
    // refresh -> retry -> 401 loop when the server rejects a newly issued token.
    if (isRefreshEndpoint) {
      return handler.next(err);
    }

    if (alreadyRetried) {
      await secureStorage.clearAll();
      onSessionExpired?.call();
      return handler.next(err);
    }

    final refreshToken = await secureStorage.getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      await secureStorage.clearAll();
      onSessionExpired?.call();
      return handler.next(err);
    }

    try {
      // Send refresh request using a separate Dio instance to avoid interceptor recursion.
      final refreshDio = Dio(
        BaseOptions(
          baseUrl: dio.options.baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
        ),
      );

      final response = await refreshDio.post(
        ApiEndpoints.refreshToken,
        data: {'refreshToken': refreshToken},
      );

      final rawData = response.data;
      final data = rawData is Map<String, dynamic> && rawData['data'] is Map<String, dynamic>
          ? rawData['data'] as Map<String, dynamic>
          : rawData;

      if (response.statusCode != 200 || data is! Map<String, dynamic>) {
        throw StateError('Refresh endpoint returned an invalid response');
      }

      final newAccessToken = data['accessToken'];
      final newRefreshToken = data['refreshToken'];
      if (newAccessToken is! String || newRefreshToken is! String ||
          newAccessToken.isEmpty || newRefreshToken.isEmpty) {
        throw StateError('Refresh endpoint did not return a valid token pair');
      }

      await secureStorage.saveTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );

      final options = err.requestOptions;
      options.extra['auth_retry'] = true;
      options.headers['Authorization'] = 'Bearer $newAccessToken';

      final retryResponse = await dio.fetch(options);
      return handler.resolve(retryResponse);
    } catch (_) {
      // Refresh token is invalid, reused, expired, or the refresh response was malformed.
      await secureStorage.clearAll();
      onSessionExpired?.call();
      return handler.reject(err);
    }
  }
}
