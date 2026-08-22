import 'dart:async';
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
    // Handle 401 Unauthorized - Token Expired
    if (err.response?.statusCode == 401) {
      final isRefreshEndpoint = err.requestOptions.path.contains(ApiEndpoints.refreshToken);

      if (!isRefreshEndpoint) {
        final refreshToken = await secureStorage.getRefreshToken();

        if (refreshToken != null && refreshToken.isNotEmpty) {
          try {
            // Send refresh request using a separate Dio instance to avoid interceptor recursion
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

            if (response.statusCode == 200 && response.data != null) {
              final data = response.data['data'] ?? response.data;
              final newAccessToken = data['accessToken'] as String?;
              final newRefreshToken = data['refreshToken'] as String?;

              if (newAccessToken != null && newRefreshToken != null) {
                await secureStorage.saveTokens(
                  accessToken: newAccessToken,
                  refreshToken: newRefreshToken,
                );

                // Retry original request with new token
                final options = err.requestOptions;
                options.headers['Authorization'] = 'Bearer $newAccessToken';

                final retryResponse = await dio.fetch(options);
                return handler.resolve(retryResponse);
              }
            }
          } catch (refreshErr) {
            // Refresh token invalid or reused -> force logout
            await secureStorage.clearAll();
            onSessionExpired?.call();
            return handler.reject(err);
          }
        }
      }
    }

    return handler.next(err);
  }
}
