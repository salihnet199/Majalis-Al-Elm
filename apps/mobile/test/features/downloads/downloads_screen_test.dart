import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/localization/app_localizations.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/storage/collections/content_meta_collection.dart';
import 'package:mobile/features/content/data/repositories/offline_content_repository.dart';
import 'package:mobile/features/downloads/presentation/downloads_screen.dart';
import 'package:mobile/features/downloads/providers/downloads_notifier.dart';

class MockOfflineContentRepository extends Mock implements IOfflineContentRepository {}

void main() {
  late MockOfflineContentRepository mockRepo;

  final sampleItem = ContentMetaCollection()
    ..contentId = 'pdf-sample-1'
    ..slug = 'pdf-sample-1'
    ..title = 'كتاب التوحيد المحفوظ'
    ..contentType = 'PDF'
    ..localFilePath = '/data/pdf-1.pdf'
    ..fileSizeBytes = 5242880 // 5 MB
    ..downloadedAt = DateTime.now();

  setUp(() {
    mockRepo = MockOfflineContentRepository();
  });

  Widget buildTestableWidget({List<ContentMetaCollection> items = const []}) {
    when(() => mockRepo.getDownloadedList(type: 'ALL')).thenAnswer((_) async => items);
    when(() => mockRepo.getTotalStorageBytes()).thenAnswer((_) async => items.isEmpty ? 0 : 5242880);

    return ProviderScope(
      overrides: [
        offlineContentRepositoryProvider.overrideWithValue(mockRepo),
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
          child: DownloadsScreen(),
        ),
      ),
    );
  }

  group('DownloadsScreen Widget Tests', () {
    testWidgets('renders storage summary banner and empty state when no items', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget(items: []));
      await tester.pumpAndSettle();

      expect(find.text('المحفوظات'), findsOneWidget);
      expect(find.text('المساحة المستخدمة بدون إنترنت'), findsOneWidget);
      expect(find.text('0 كيلوبايت'), findsOneWidget);
      expect(find.text('لا توجد مواد محفوظة في هذا القسم'), findsOneWidget);
    });

    testWidgets('renders downloaded content item card and filter chips', (WidgetTester tester) async {
      await tester.pumpWidget(buildTestableWidget(items: [sampleItem]));
      await tester.pumpAndSettle();

      expect(find.text('كتاب التوحيد المحفوظ'), findsOneWidget);
      expect(find.textContaining('5.0 ميجابايت'), findsWidgets);
      expect(find.byIcon(Icons.delete_outline_rounded), findsOneWidget);
      expect(find.text('صوتيات'), findsOneWidget);
      expect(find.text('كتب و PDF'), findsOneWidget);
    });
  });
}
