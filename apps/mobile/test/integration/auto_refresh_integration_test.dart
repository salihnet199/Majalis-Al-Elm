import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';

void main() {
  const testBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  late SecureStorageService secureStorage;
  late ApiClient apiClient;
  late AuthRepository authRepository;

  final runId = '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
  final testEmail = 'autorefresh_$runId@test.majaliselm.local';
  const testPassword = 'AutoRefreshPass123!';
  const testFullName = 'مستخدم اختبار التجديد التلقائي';

  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
    secureStorage = SecureStorageService();

    apiClient = ApiClient(
      secureStorage: secureStorage,
      baseUrl: testBaseUrl,
    );

    authRepository = AuthRepository(
      apiClient: apiClient,
      secureStorage: secureStorage,
    );
  });

  group('Token Auto-Refresh on 401 Verification against Live Backend & PostgreSQL', () {
    test('Auto-Refresh on 401: Intercepts 401, calls /auth/token/refresh, and transparently retries request', () async {
      // 1. Register user & obtain initial tokens
      final authResponse = await authRepository.registerWithEmail(
        fullName: testFullName,
        email: testEmail,
        password: testPassword,
      );

      final initialAccessToken = authResponse.accessToken;
      final initialRefreshToken = authResponse.refreshToken;

      expect(initialAccessToken, isNotEmpty);
      expect(initialRefreshToken, isNotEmpty);

      // 2. Corrupt / Expire the stored Access Token intentionally to simulate 401 on protected endpoint
      final prefix = initialAccessToken.substring(0, initialAccessToken.length - 10);
      final expiredAccessToken = '${prefix}XXXXXXXXXX';
      await secureStorage.saveTokens(
        accessToken: expiredAccessToken,
        refreshToken: initialRefreshToken,
      );

      final tamperedStoredToken = await secureStorage.getAccessToken();
      expect(tamperedStoredToken, equals(expiredAccessToken));

      // 3. Request protected resource (GET /auth/users/me) through ApiClient (with AuthInterceptor)
      final userProfile = await authRepository.getCurrentUser();

      expect(userProfile, isNotNull);
      expect(userProfile.email?.toLowerCase(), equals(testEmail.toLowerCase()));
      expect(userProfile.fullName, equals(testFullName));

      // 4. Verify that SecureStorage now contains the NEW rotated tokens (different from expired/initial)
      final updatedAccessToken = await secureStorage.getAccessToken();
      final updatedRefreshToken = await secureStorage.getRefreshToken();

      expect(updatedAccessToken, isNotNull);
      expect(updatedRefreshToken, isNotNull);
      expect(updatedAccessToken, isNot(equals(expiredAccessToken)));
      expect(updatedAccessToken, isNot(equals(initialAccessToken)));
      expect(updatedRefreshToken, isNot(equals(initialRefreshToken)));
    });
  });
}
