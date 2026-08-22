import 'package:dio/dio.dart';
import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/network/error_handler.dart';
import '../../../../core/storage/secure_storage_service.dart';
import '../models/auth_tokens_model.dart';
import '../models/user_model.dart';

abstract class IAuthRepository {
  Future<AuthResponseModel> loginWithEmail({
    required String email,
    required String password,
  });

  Future<AuthResponseModel> registerWithEmail({
    required String fullName,
    required String email,
    required String password,
  });

  Future<AuthResponseModel> loginWithGoogle({
    required String idToken,
    String? fullName,
    String? email,
  });

  Future<AuthResponseModel> loginWithApple({
    required String idToken,
    String? fullName,
    String? email,
  });

  Future<UserModel> getCurrentUser();

  Future<void> logout();

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  });
}

class AuthRepository implements IAuthRepository {
  final ApiClient apiClient;
  final SecureStorageService secureStorage;

  AuthRepository({
    required this.apiClient,
    required this.secureStorage,
  });

  @override
  Future<AuthResponseModel> loginWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final response = await apiClient.post(
        ApiEndpoints.loginEmail,
        data: {
          'email': email,
          'password': password,
        },
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final authResponse = AuthResponseModel.fromJson(payload as Map<String, dynamic>);

      await secureStorage.saveTokens(
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
      );
      await secureStorage.saveUserData(
        userId: authResponse.user.id,
        role: authResponse.user.role,
      );

      return authResponse;
    } on DioException catch (e) {
      throw _parseError(e, 'فشل الاتصال بالخادم، يرجى المحاولة لاحقاً');
    }
  }

  @override
  Future<AuthResponseModel> registerWithEmail({
    required String fullName,
    required String email,
    required String password,
  }) async {
    try {
      final response = await apiClient.post(
        ApiEndpoints.registerEmail,
        data: {
          'fullName': fullName,
          'email': email,
          'password': password,
        },
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final authResponse = AuthResponseModel.fromJson(payload as Map<String, dynamic>);

      await secureStorage.saveTokens(
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
      );
      await secureStorage.saveUserData(
        userId: authResponse.user.id,
        role: authResponse.user.role,
      );

      return authResponse;
    } on DioException catch (e) {
      throw _parseError(e, 'فشل إنشاء الحساب، يرجى المحاولة لاحقاً');
    }
  }

  @override
  Future<AuthResponseModel> loginWithGoogle({
    required String idToken,
    String? fullName,
    String? email,
  }) async {
    try {
      final response = await apiClient.post(
        ApiEndpoints.loginGoogle,
        data: {
          'idToken': idToken,
          if (fullName != null) 'fullName': fullName,
          if (email != null) 'email': email,
        },
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final authResponse = AuthResponseModel.fromJson(payload as Map<String, dynamic>);

      await secureStorage.saveTokens(
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
      );
      await secureStorage.saveUserData(
        userId: authResponse.user.id,
        role: authResponse.user.role,
      );

      return authResponse;
    } on DioException catch (e) {
      throw _parseError(e, 'فشل تسجيل الدخول عبر حساب Google');
    }
  }

  @override
  Future<AuthResponseModel> loginWithApple({
    required String idToken,
    String? fullName,
    String? email,
  }) async {
    try {
      final response = await apiClient.post(
        ApiEndpoints.loginApple,
        data: {
          'idToken': idToken,
          if (fullName != null) 'fullName': fullName,
          if (email != null) 'email': email,
        },
      );

      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      final authResponse = AuthResponseModel.fromJson(payload as Map<String, dynamic>);

      await secureStorage.saveTokens(
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
      );
      await secureStorage.saveUserData(
        userId: authResponse.user.id,
        role: authResponse.user.role,
      );

      return authResponse;
    } on DioException catch (e) {
      throw _parseError(e, 'فشل تسجيل الدخول عبر حساب Apple');
    }
  }

  @override
  Future<UserModel> getCurrentUser() async {
    try {
      final response = await apiClient.get(ApiEndpoints.userMe);
      final rawData = response.data;
      final payload = rawData is Map<String, dynamic> && rawData.containsKey('data')
          ? rawData['data']
          : rawData;

      return UserModel.fromJson(payload as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _parseError(e, 'فشل استرجاع بيانات المستخدم');
    }
  }

  @override
  Future<void> logout() async {
    try {
      final refreshToken = await secureStorage.getRefreshToken();
      if (refreshToken != null) {
        await apiClient.post(
          ApiEndpoints.logout,
          data: {'refreshToken': refreshToken},
        );
      }
    } catch (_) {
      // Idempotent: ignore errors during logout network call
    } finally {
      await secureStorage.clearAll();
    }
  }

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await apiClient.post(
        ApiEndpoints.changePassword,
        data: {
          'currentPassword': currentPassword,
          'newPassword': newPassword,
        },
      );
    } on DioException catch (e) {
      throw _parseError(e, 'فشل تغيير كلمة المرور');
    }
  }

  AppException _parseError(DioException e, String fallbackMessage) {
    if (e.response?.data != null && e.response?.data is Map<String, dynamic>) {
      final map = e.response!.data as Map<String, dynamic>;
      final errorData = map['error'] ?? map;
      if (errorData is Map<String, dynamic> &&
          (errorData.containsKey('code') || errorData.containsKey('message'))) {
        return AppException.fromApiError(ApiError.fromJson(errorData));
      }
    }
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout) {
      return const AppException(
        code: 'NETWORK_ERROR',
        message: 'تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت أو تجربة الدخول كزائر',
      );
    }
    return AppException(
      code: 'NETWORK_ERROR',
      message: fallbackMessage,
    );
  }
}
