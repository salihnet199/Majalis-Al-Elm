import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/localization/app_localizations.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';
import 'package:mobile/features/auth/presentation/register_screen.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';

class MockAuthRepository extends Mock implements IAuthRepository {}
class MockSecureStorageService extends Mock implements SecureStorageService {}

void main() {
  late MockAuthRepository mockRepository;
  late MockSecureStorageService mockSecureStorage;

  setUp(() {
    mockRepository = MockAuthRepository();
    mockSecureStorage = MockSecureStorageService();
  });

  Widget buildTestableWidget() {
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
          child: RegisterScreen(),
        ),
      ),
    );
  }

  group('RegisterScreen Widget Tests', () {
    testWidgets('renders all registration fields and submit button', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      expect(find.text('الاسم الكامل'), findsOneWidget);
      expect(find.text('البريد الإلكتروني'), findsOneWidget);
      expect(find.text('كلمة المرور'), findsOneWidget);
      expect(find.text('تأكيد كلمة المرور'), findsOneWidget);
      expect(find.widgetWithText(ElevatedButton, 'إنشاء حساب جديد'), findsOneWidget);
    });

    testWidgets('validates required registration fields', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      final buttonFinder = find.widgetWithText(ElevatedButton, 'إنشاء حساب جديد');
      await tester.ensureVisible(buttonFinder);
      await tester.tap(buttonFinder);
      await tester.pump();

      expect(find.text('يرجى إدخال الاسم الكامل'), findsOneWidget);
      expect(find.text('يرجى إدخال البريد الإلكتروني'), findsOneWidget);
      expect(find.text('يرجى إدخال كلمة المرور'), findsOneWidget);
    });
  });
}
