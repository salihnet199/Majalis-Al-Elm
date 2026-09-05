import 'package:dio/dio.dart';
import '../constants/api_endpoints.dart';
import '../constants/app_constants.dart';
import '../storage/secure_storage_service.dart';
import 'auth_interceptor.dart';

class ApiClient {
  late final Dio dio;
  final SecureStorageService secureStorage;
  void Function()? onSessionExpired;

  ApiClient({
    required this.secureStorage,
    this.onSessionExpired,
    String? baseUrl,
  }) {
    dio = Dio(
      BaseOptions(
        baseUrl: baseUrl ?? ApiEndpoints.baseUrl,
        connectTimeout: AppConstants.connectTimeout,
        receiveTimeout: AppConstants.receiveTimeout,
        headers: {
          'Accept': 'application/json; charset=utf-8',
          'Content-Type': 'application/json; charset=utf-8',
        },
      ),
    );

    dio.interceptors.add(
      AuthInterceptor(
        dio: dio,
        secureStorage: secureStorage,
        onSessionExpired: () => this.onSessionExpired?.call(),
      ),
    );
  }

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return dio.get<T>(
      path,
      queryParameters: queryParameters,
      options: options,
    );
  }

  Future<Response<T>> post<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return dio.post<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  Future<Response<T>> patch<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return dio.patch<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  Future<Response<T>> delete<T>(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) {
    return dio.delete<T>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }
}
