import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/localization/app_localizations.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/auth/providers/auth_state.dart';
import 'package:mobile/features/content/data/repositories/offline_content_repository.dart';
import 'package:mobile/features/downloads/providers/downloads_notifier.dart';
import 'package:mobile/features/home/presentation/main_shell.dart';

class MockOfflineContentRepository extends Mock implements IOfflineContentRepository {}

void main() {
  late MockOfflineContentRepository mockOfflineRepo;

  const testUser = UserModel(
    id: '01920abc-1234-7890-abcd-000000000001',
    fullName: 'أحمد محمد',
    email: 'ahmed@example.com',
    role: 'User',
  );

  setUp(() {
    mockOfflineRepo = MockOfflineContentRepository();
    when(() => mockOfflineRepo.getDownloadedList(type: 'ALL')).thenAnswer((_) async => []);
    when(() => mockOfflineRepo.getTotalStorageBytes()).thenAnswer((_) async => 0);
  });

  Widget buildTestableWidget() {
    return ProviderScope(
      overrides: [
        authNotifierProvider.overrideWith((ref) => MockAuthNotifier(
              const Authenticated(testUser),
            )),
        offlineContentRepositoryProvider.overrideWithValue(mockOfflineRepo),
      ],
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar'), Locale('en')],
        localizationsDelegates: const [
          AppLocalizationsDelegate(),
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: const Directionality(
          textDirection: TextDirection.rtl,
          child: MainShell(),
        ),
      ),
    );
  }

  group('MainShell Navigation Tests', () {
    testWidgets('renders all navigation destinations and switches tabs', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pumpAndSettle();

      expect(find.text('الرئيسية'), findsWidgets);
      expect(find.text('الصوتيات'), findsOneWidget);
      expect(find.text('الكتب'), findsOneWidget);
      expect(find.text('المحفوظات'), findsOneWidget);
      expect(find.text('حسابي'), findsOneWidget);

      // Verify Home Screen is active initially
      expect(find.textContaining('أحدث المواد المنشورة'), findsOneWidget);

      // Switch to Audio tab
      await tester.tap(find.widgetWithText(NavigationDestination, 'الصوتيات'));
      await tester.pumpAndSettle();
      expect(find.text('الصوتيات والدروس'), findsWidgets);

      // Switch to Books tab
      await tester.tap(find.widgetWithText(NavigationDestination, 'الكتب'));
      await tester.pumpAndSettle();
      expect(find.text('مكتبة الكتب و PDF'), findsWidgets);

      // Switch to Downloads tab
      await tester.tap(find.widgetWithText(NavigationDestination, 'المحفوظات'));
      await tester.pumpAndSettle();
      expect(find.text('المساحة المستخدمة بدون إنترنت'), findsOneWidget);

      // Switch to Profile tab
      await tester.tap(find.widgetWithText(NavigationDestination, 'حسابي'));
      await tester.pumpAndSettle();
      expect(find.text('عن صاحب المجلس'), findsOneWidget);
    });
  });
}

class MockAuthNotifier extends StateNotifier<AuthState> implements AuthNotifier {
  MockAuthNotifier(super.state);

  @override
  IAuthRepository get repository => throw UnimplementedError();

  @override
  SecureStorageService get secureStorage => throw UnimplementedError();

  @override
  Future<void> checkAuthStatus() async {}

  @override
  Future<bool> loginWithEmail({required String email, required String password}) async => true;

  @override
  Future<bool> registerWithEmail({required String fullName, required String email, required String password}) async => true;

  @override
  Future<bool> loginWithGoogle({required String idToken, String? fullName, String? email}) async => true;

  @override
  Future<bool> loginWithApple({required String idToken, String? fullName, String? email}) async => true;

  @override
  void loginAsGuest() {
    state = const Authenticated(
      UserModel(
        id: 'guest_user_1',
        fullName: 'زائر مجالس العالم',
        email: 'guest@majlis-alim.com',
        role: 'STUDENT',
      ),
    );
  }

  @override
  Future<void> logout() async {
    state = const Unauthenticated();
  }

  @override
  void handleSessionExpired() {
    state = const Unauthenticated();
  }
}
