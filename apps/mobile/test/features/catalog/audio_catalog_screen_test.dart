import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/localization/app_localizations.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/catalog/presentation/audio_catalog_screen.dart';

void main() {
  Widget buildTestableWidget() {
    return MaterialApp(
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
        child: AudioCatalogScreen(),
      ),
    );
  }

  group('AudioCatalogScreen Widget Tests', () {
    testWidgets('renders search bar, category chips, and audio list items', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      expect(find.text('الصوتيات والدروس'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('جميع التصنيفات'), findsOneWidget);
      expect(find.text('العقيدة'), findsWidgets);
      expect(find.text('الفقه'), findsWidgets);
      expect(find.text('تفسير سورة الفاتحة وقصار السور'), findsOneWidget);
    });

    testWidgets('filters audio list when clicking on category chip', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();

      // Tap 'الفقه' category
      await tester.tap(find.text('الفقه').first);
      await tester.pump();

      expect(find.text('أحكام الطهارة والصلاة من زاد المستقنع'), findsOneWidget);
      expect(find.text('تفسير سورة الفاتحة وقصار السور'), findsNothing);
    });
  });
}
