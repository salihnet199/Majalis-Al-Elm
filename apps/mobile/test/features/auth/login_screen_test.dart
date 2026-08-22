import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/localization/app_localizations.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';
import 'package:mobile/features/auth/presentation/login_screen.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/auth/providers/auth_state.dart';

class MockAuthRepository extends Mock implements IAuthRepository {}
class MockSecureStorageService extends Mock implements SecureStorageService {}

void main() {
  late MockAuthRepository mockRepository;
  late MockSecureStorageService mockSecureStorage;

  setUp(() {
    mockRepository = MockAuthRepository();
    mockSecureStorage = MockSecureStorageService();
  });

  Widget buildTestableWidget({AuthState initialState = const Unauthenticated()}) {
    return ProviderScope(
      overrides: [
        authNotifierProvider.overrideWith((ref) => AuthNotifier(
              repository: mockRepository,
              secureStorage: mockSecureStorage,
            )),
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
          child: LoginScreen(),
        ),
      ),
    );
  }

  group('LoginScreen Widget Tests', () {
    testWidgets('renders all input fields, buttons, and social badges', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      expect(find.text('البريد الإلكتروني'), findsOneWidget);
      expect(find.text('كلمة المرور'), findsOneWidget);
      expect(find.text('تسجيل الدخول'), findsOneWidget);
      expect(find.text('Google'), findsOneWidget);
      expect(find.text('Apple'), findsOneWidget);
      expect(find.text('هاتف OTP'), findsOneWidget);
      expect(find.text('قريباً'), findsOneWidget);
    });

    testWidgets('shows validation errors when fields are empty', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      await tester.tap(find.widgetWithText(ElevatedButton, 'تسجيل الدخول'));
      await tester.pump();

      expect(find.text('يرجى إدخال البريد الإلكتروني'), findsOneWidget);
      expect(find.text('يرجى إدخال كلمة المرور'), findsOneWidget);
    });

    testWidgets('shows invalid email format error', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      final textFields = find.byType(TextFormField);
      await tester.enterText(textFields.first, 'invalid-email');
      await tester.enterText(textFields.last, '12345678');

      await tester.tap(find.widgetWithText(ElevatedButton, 'تسجيل الدخول'));
      await tester.pump();

      expect(find.text('صيغة البريد الإلكتروني غير صحيحة'), findsOneWidget);
    });
  });
}
