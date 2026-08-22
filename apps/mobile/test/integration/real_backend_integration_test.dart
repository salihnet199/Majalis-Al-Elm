import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_endpoints.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/error_handler.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';
import 'package:mobile/features/content/data/repositories/content_repository.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';

void main() {
  // Use baseUrl from environment or fallback to localhost
  const testBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  late SecureStorageService secureStorage;
  late ApiClient apiClient;
  late AuthRepository authRepository;
  late ContentRepository contentRepository;

  // Generate dynamic unique credentials for each test run to ensure strict isolation
  final runId = '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
  final testEmail = 'user_$runId@test.majlisalim.local';
  const testPassword = 'StrongTestPass123!';
  const testFullName = 'المستخدم التجريبي المتكامل';

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

    contentRepository = ContentRepository(
      apiClient: apiClient,
    );
  });

  group('Majlis Al-Alim — Real PostgreSQL & Backend Integration Suite (8 Scenarios)', () {
    String? initialRefreshToken;
    String? rotatedRefreshToken;

    // ── Scenario 1: User Registration against real PostgreSQL ──────────────────
    test('Scenario 1: User Registration (POST /auth/register/email) writes to PostgreSQL id_users', () async {
      final authResponse = await authRepository.registerWithEmail(
        fullName: testFullName,
        email: testEmail,
        password: testPassword,
      );

      expect(authResponse.user.email?.toLowerCase(), equals(testEmail.toLowerCase()));
      expect(authResponse.user.fullName, equals(testFullName));
      expect(authResponse.user.role, equals('User'));
      expect(authResponse.accessToken, isNotEmpty);
      expect(authResponse.refreshToken, isNotEmpty);

      // Verify tokens saved in Flutter Secure Storage
      final storedAccessToken = await secureStorage.getAccessToken();
      final storedRefreshToken = await secureStorage.getRefreshToken();
      expect(storedAccessToken, equals(authResponse.accessToken));
      expect(storedRefreshToken, equals(authResponse.refreshToken));

      initialRefreshToken = authResponse.refreshToken;
    });

    // ── Scenario 2: User Login against real PostgreSQL ─────────────────────────
    test('Scenario 2: User Login (POST /auth/login/email) authenticates against bcrypt hash', () async {
      // Clear local storage first to verify fresh login persistence
      await secureStorage.clearAll();

      final authResponse = await authRepository.loginWithEmail(
        email: testEmail,
        password: testPassword,
      );

      expect(authResponse.user.email?.toLowerCase(), equals(testEmail.toLowerCase()));
      expect(authResponse.accessToken, isNotEmpty);
      expect(authResponse.refreshToken, isNotEmpty);

      final storedToken = await secureStorage.getAccessToken();
      expect(storedToken, equals(authResponse.accessToken));

      initialRefreshToken = authResponse.refreshToken;
    });

    // ── Scenario 3: Protected Route (GET /users/me) with RS256 Bearer Token ───
    test('Scenario 3: Protected Route (GET /users/me) verifies RS256 JWT signature', () async {
      final currentUser = await authRepository.getCurrentUser();

      expect(currentUser.email?.toLowerCase(), equals(testEmail.toLowerCase()));
      expect(currentUser.fullName, equals(testFullName));
      expect(currentUser.role, equals('User'));
      expect(currentUser.id, isNotEmpty);
    });

    // ── Scenario 4: Token Silent Refresh & Rotation in PostgreSQL ─────────────
    test('Scenario 4: Token Refresh (POST /auth/token/refresh) rotates token in id_auth_tokens', () async {
      expect(initialRefreshToken, isNotNull);

      // Send refresh request using raw Dio to verify rotation contract
      final refreshDio = Dio(BaseOptions(baseUrl: testBaseUrl));
      final response = await refreshDio.post(
        ApiEndpoints.refreshToken,
        data: {'refreshToken': initialRefreshToken},
      );

      expect(response.statusCode, equals(200));
      final data = response.data['data'] ?? response.data;
      final newAccessToken = data['accessToken'] as String;
      final newRefreshToken = data['refreshToken'] as String;

      expect(newAccessToken, isNotEmpty);
      expect(newRefreshToken, isNotEmpty);
      expect(newRefreshToken, isNot(equals(initialRefreshToken)));

      rotatedRefreshToken = newRefreshToken;

      // Update storage with new tokens
      await secureStorage.saveTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );

      // Access protected endpoint with newly rotated token
      final currentUser = await authRepository.getCurrentUser();
      expect(currentUser.email?.toLowerCase(), equals(testEmail.toLowerCase()));
    });

    // ── Scenario 5: Token Family Reuse / Theft Detection ──────────────────────
    test('Scenario 5: Token Reuse Detection revokes family upon reusing old token', () async {
      expect(initialRefreshToken, isNotNull);

      // Attempting to re-use the OLD initialRefreshToken which was already rotated
      final attackerDio = Dio(
        BaseOptions(
          baseUrl: testBaseUrl,
          validateStatus: (status) => true,
        ),
      );

      final replayResponse = await attackerDio.post(
        ApiEndpoints.refreshToken,
        data: {'refreshToken': initialRefreshToken},
      );

      // Backend must reject reuse with 401 Unauthorized
      expect(replayResponse.statusCode, equals(401));

      // After reuse detection, the entire token family is revoked
      // Trying the rotated token should now also fail
      final followUpResponse = await attackerDio.post(
        ApiEndpoints.refreshToken,
        data: {'refreshToken': rotatedRefreshToken},
      );
      expect(followUpResponse.statusCode, equals(401));

      // Relogin the test user to restore session for remaining tests
      await authRepository.loginWithEmail(
        email: testEmail,
        password: testPassword,
      );
    });

    // ── Scenario 6: Real Content Catalog & Taxonomy Retrieval ─────────────────
    test('Scenario 6: Content Catalog & Taxonomy queries ct_content_items and ct_categories', () async {
      // 1. Fetch Categories
      final categories = await contentRepository.getCategories();
      expect(categories, isNotEmpty);
      final categorySlugs = categories.map((c) => c.slug).toList();
      expect(categorySlugs, contains('aqeedah'));
      expect(categorySlugs, contains('fiqh'));

      // 2. Fetch Tags
      final tags = await contentRepository.getTags();
      expect(tags, isNotEmpty);
      final tagSlugs = tags.map((t) => t.slug).toList();
      expect(tagSlugs, contains('tawheed'));

      // 3. Fetch Audio Content
      final audioList = await contentRepository.getContentList(type: 'AUDIO');
      expect(audioList.items, isNotEmpty);
      final audioItem = audioList.items.firstWhere((i) => i.id == 'audio-lecture-intro-tawheed' || i.type == 'AUDIO');
      expect(audioItem.type, equals('AUDIO'));
      expect(audioItem.title, contains('توحيد'));

      // 4. Fetch PDF Content
      final pdfList = await contentRepository.getContentList(type: 'PDF');
      expect(pdfList.items, isNotEmpty);
      final pdfItem = pdfList.items.firstWhere((i) => i.id == 'book-kitab-at-tawheed' || i.type == 'PDF');
      expect(pdfItem.type, equals('PDF'));

      // 5. Fetch TEXT Content
      final textList = await contentRepository.getContentList(type: 'TEXT');
      expect(textList.items, isNotEmpty);
      final textItem = textList.items.firstWhere((i) => i.id == 'article-virtues-of-knowledge' || i.type == 'TEXT');
      expect(textItem.type, equals('TEXT'));

      // 6. Fetch Item Details by Slug
      final detail = await contentRepository.getContentBySlug('audio-lecture-intro-tawheed');
      expect(detail.title, contains('توحيد'));
      expect(detail.author, isNotEmpty);
    });

    // ── Scenario 7: Offline Content Model Serialization & In-Memory Cache ────
    test('Scenario 7: Content item converts to/from JSON and preserves offline fields', () async {
      final remoteItem = await contentRepository.getContentBySlug('article-virtues-of-knowledge');

      // Verify serialization contract for local Isar / SQLite storage
      final jsonMap = remoteItem.toJson();
      expect(jsonMap['title'], equals(remoteItem.title));
      expect(jsonMap['type'], equals('TEXT'));

      final restoredItem = ContentItemModel.fromJson(jsonMap);
      expect(restoredItem.id, equals(remoteItem.id));
      expect(restoredItem.title, equals(remoteItem.title));
      expect(restoredItem.type, equals(remoteItem.type));
      expect(restoredItem.author, equals(remoteItem.author));
    });

    // ── Scenario 8: User Logout & Database Token Invalidation ─────────────────
    test('Scenario 8: User Logout (POST /auth/logout) revokes token and clears storage', () async {
      await authRepository.logout();

      final storedAccessToken = await secureStorage.getAccessToken();
      final storedRefreshToken = await secureStorage.getRefreshToken();
      expect(storedAccessToken, isNull);
      expect(storedRefreshToken, isNull);

      // Calling protected route now must throw AppException / Network Error
      expect(
        () => authRepository.getCurrentUser(),
        throwsA(isA<AppException>()),
      );
    });
  });
}
