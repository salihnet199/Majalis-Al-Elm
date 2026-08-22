import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/network/error_handler.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/models/auth_tokens_model.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/auth/providers/auth_state.dart';

class MockAuthRepository extends Mock implements IAuthRepository {}
class MockSecureStorageService extends Mock implements SecureStorageService {}

void main() {
  late MockAuthRepository mockRepository;
  late MockSecureStorageService mockSecureStorage;
  late AuthNotifier authNotifier;

  const testUser = UserModel(
    id: '01920abc-1234-7890-abcd-000000000001',
    fullName: 'أحمد محمد',
    email: 'ahmed@example.com',
    role: 'User',
  );

  const testAuthResponse = AuthResponseModel(
    user: testUser,
    accessToken: 'test_access_token',
    refreshToken: 'test_refresh_token',
    expiresIn: 900,
  );

  setUp(() {
    mockRepository = MockAuthRepository();
    mockSecureStorage = MockSecureStorageService();
    authNotifier = AuthNotifier(
      repository: mockRepository,
      secureStorage: mockSecureStorage,
    );
  });

  group('AuthNotifier Unit Tests', () {
    test('initial state should be AuthInitial', () {
      expect(authNotifier.state, const AuthInitial());
    });

    test('checkAuthStatus emits Unauthenticated when no tokens found', () async {
      when(() => mockSecureStorage.getAccessToken()).thenAnswer((_) async => null);
      when(() => mockSecureStorage.getRefreshToken()).thenAnswer((_) async => null);

      await authNotifier.checkAuthStatus();

      expect(authNotifier.state, const Unauthenticated());
    });

    test('checkAuthStatus emits Authenticated when valid user retrieved', () async {
      when(() => mockSecureStorage.getAccessToken()).thenAnswer((_) async => 'valid_token');
      when(() => mockSecureStorage.getRefreshToken()).thenAnswer((_) async => 'valid_refresh');
      when(() => mockRepository.getCurrentUser()).thenAnswer((_) async => testUser);

      await authNotifier.checkAuthStatus();

      expect(authNotifier.state, const Authenticated(testUser));
    });

    test('loginWithEmail sets Authenticated on success', () async {
      when(() => mockRepository.loginWithEmail(
            email: 'ahmed@example.com',
            password: 'password123',
          )).thenAnswer((_) async => testAuthResponse);

      final result = await authNotifier.loginWithEmail(
        email: 'ahmed@example.com',
        password: 'password123',
      );

      expect(result, isTrue);
      expect(authNotifier.state, const Authenticated(testUser));
    });

    test('loginWithEmail sets AuthError on invalid credentials', () async {
      when(() => mockRepository.loginWithEmail(
            email: 'ahmed@example.com',
            password: 'wrong_password',
          )).thenThrow(const AppException(
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      ));

      final result = await authNotifier.loginWithEmail(
        email: 'ahmed@example.com',
        password: 'wrong_password',
      );

      expect(result, isFalse);
      expect(authNotifier.state, isA<AuthError>());
      final errorState = authNotifier.state as AuthError;
      expect(errorState.code, 'AUTH_INVALID_CREDENTIALS');
      expect(errorState.message, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
    });

    test('logout clears state to Unauthenticated', () async {
      when(() => mockRepository.logout()).thenAnswer((_) async {});

      await authNotifier.logout();

      expect(authNotifier.state, const Unauthenticated());
    });
  });
}
