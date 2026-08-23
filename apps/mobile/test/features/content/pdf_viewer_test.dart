import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/network/error_handler.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/presentation/pdf/pdf_viewer_screen.dart';
import 'package:mobile/features/content/providers/media_source_provider.dart';

void main() {
  const testPdfItem = ContentItemModel(
    id: 'pdf-test-1',
    slug: 'kitab-al-tawhid',
    title: 'كتاب التوحيد',
    description: 'متن كتاب التوحيد',
    type: AppConstants.typePdf,
    // Deliberately a thumbnail: the viewer must never open this field.
    url: 'https://cdn.example.com/thumbnails/book.jpg',
    author: 'الإمام المجدد',
    pageCount: 120,
  );

  Widget wrap(Widget child, {List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: child,
        ),
      ),
    );
  }

  group('PdfViewerScreen Widget Tests', () {
    testWidgets('renders PDF title, jump button, and page indicator', (WidgetTester tester) async {
      // isTestMode renders the chrome without resolving or opening a document;
      // there is no PDF rendering backend in a widget test.
      await tester.pumpWidget(
        wrap(const PdfViewerScreen(item: testPdfItem, isTestMode: true)),
      );

      await tester.pump();

      expect(find.text('كتاب التوحيد'), findsWidgets);
      expect(find.byIcon(Icons.bookmark_border_rounded), findsOneWidget);
      expect(find.textContaining('صفحة 1 من 120'), findsOneWidget);
    });

    testWidgets('shows the real Arabic error when the stream cannot be resolved',
        (WidgetTester tester) async {
      // The viewer used to open `item.url` through a loader that returned
      // `Uint8List(0)` for every URL, so an unreachable file presented as a
      // zero-byte document that opened "successfully" (POLICY-SEC-001 category 3,
      // TECH-DEBT-016). A failure must now be visible and retryable.
      await tester.pumpWidget(
        wrap(
          const PdfViewerScreen(item: testPdfItem),
          overrides: [
            mediaSourceProvider(testPdfItem).overrideWith(
              (ref) async => throw const AppException(
                code: 'MEDIA_NOT_AVAILABLE',
                message: 'الملف غير متاح للقراءة بعد',
              ),
            ),
          ],
        ),
      );

      await tester.pump();
      await tester.pump();

      expect(find.text('الملف غير متاح للقراءة بعد'), findsOneWidget);
      expect(find.text('إعادة المحاولة'), findsOneWidget);
    });

    testWidgets('download button states the truth instead of confirming a queued download',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(const PdfViewerScreen(item: testPdfItem, isTestMode: true)),
      );
      await tester.pump();

      await tester.tap(find.byIcon(Icons.download_for_offline_outlined));
      await tester.pump();

      expect(find.textContaining('غير متاح بعد'), findsOneWidget);
      expect(find.textContaining('قائمة التنزيل'), findsNothing);
    });
  });
}
