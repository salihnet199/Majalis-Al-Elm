import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/error_handler.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../data/repositories/auth_repository.dart';
import 'auth_state.dart';

// Core Dependency Providers
final secureStorageProvider = Provider<SecureStorageService>((ref) {
  return SecureStorageService();
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final storage = ref.watch(secureStorageProvider);
  return ApiClient(
    secureStorage: storage,
  );
});

final authRepositoryProvider = Provider<IAuthRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final secureStorage = ref.watch(secureStorageProvider);
  return AuthRepository(
    apiClient: apiClient,
    secureStorage: secureStorage,
  );
});

// Auth State Notifier Provider
final authNotifierProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  final secureStorage = ref.watch(secureStorageProvider);
  final apiClient = ref.watch(apiClientProvider);

  final notifier = AuthNotifier(
    repository: repository,
    secureStorage: secureStorage,
  );

  // Wire session expiration into auth state. Without this callback the
  // interceptor can clear secure storage while the UI remains in Authenticated
  // state and never redirects to login.
  apiClient.onSessionExpired = notifier.handleSessionExpired;
  ref.onDispose(() {
    apiClient.onSessionExpired = null;
  });

  return notifier;
});

class AuthNotifier extends StateNotifier<AuthState> {
  final IAuthRepository repository;
  final SecureStorageService secureStorage;

  AuthNotifier({
    required this.repository,
    required this.secureStorage,
  }) : super(const AuthInitial());

  /// Check persisted token on app startup
  Future<void> checkAuthStatus() async {
    state = const AuthLoading();
    try {
      final token = await secureStorage.getAccessToken();
      final refreshToken = await secureStorage.getRefreshToken();

      if (token == null && refreshToken == null) {
        state = const Unauthenticated();
        return;
      }

      final user = await repository.getCurrentUser();
      state = Authenticated(user);
    } catch (_) {
      // Failed to restore session -> clean tokens
      await secureStorage.clearAll();
      state = const Unauthenticated();
    }
  }

  /// Login with Email + Password
  Future<bool> loginWithEmail({
    required String email,
    required String password,
  }) async {
    state = const AuthLoading();
    try {
      final response = await repository.loginWithEmail(
        email: email,
        password: password,
      );
      state = Authenticated(response.user);
      return true;
    } on AppException catch (e) {
      state = AuthError(message: e.message, code: e.code);
      return false;
    } catch (e) {
      state = const AuthError(
        message: 'حدث خطأ غير متوقع أثناء تسجيل الدخول',
        code: 'UNKNOWN_ERROR',
      );
      return false;
    }
  }

  /// Register new user with Full Name + Email + Password
  Future<bool> registerWithEmail({
    required String fullName,
    required String email,
    required String password,
  }) async {
    state = const AuthLoading();
    try {
      final response = await repository.registerWithEmail(
        fullName: fullName,
        email: email,
        password: password,
      );
      state = Authenticated(response.user);
      return true;
    } on AppException catch (e) {
      state = AuthError(message: e.message, code: e.code);
      return false;
    } catch (e) {
      state = const AuthError(
        message: 'حدث خطأ غير متوقع أثناء إنشاء الحساب',
        code: 'UNKNOWN_ERROR',
      );
      return false;
    }
  }

  /// Login or register with Google OAuth
  Future<bool> loginWithGoogle({
    required String idToken,
    String? fullName,
    String? email,
  }) async {
    state = const AuthLoading();
    try {
      final response = await repository.loginWithGoogle(
        idToken: idToken,
        fullName: fullName,
        email: email,
      );
      state = Authenticated(response.user);
      return true;
    } on AppException catch (e) {
      state = AuthError(message: e.message, code: e.code);
      return false;
    } catch (_) {
      state = const AuthError(
        message: 'تعذر تسجيل الدخول عبر Google، يرجى المحاولة لاحقاً',
        code: 'OAUTH_ERROR',
      );
      return false;
    }
  }

  /// Login or register with Apple Sign-In
  Future<bool> loginWithApple({
    required String idToken,
    String? fullName,
    String? email,
  }) async {
    state = const AuthLoading();
    try {
      final response = await repository.loginWithApple(
        idToken: idToken,
        fullName: fullName,
        email: email,
      );
      state = Authenticated(response.user);
      return true;
    } on AppException catch (e) {
      state = AuthError(message: e.message, code: e.code);
      return false;
    } catch (_) {
      state = const AuthError(
        message: 'تعذر تسجيل الدخول عبر Apple، يرجى المحاولة لاحقاً',
        code: 'OAUTH_ERROR',
      );
      return false;
    }
  }

  /// Logout
  Future<void> logout() async {
    state = const AuthLoading();
    await repository.logout();
    state = const Unauthenticated();
  }

  /// Handle session expired trigger from ApiClient
  void handleSessionExpired() {
    state = const Unauthenticated(message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
  }
}
