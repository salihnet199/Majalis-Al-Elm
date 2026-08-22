import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/presentation/pdf/pdf_viewer_screen.dart';

void main() {
  const testPdfItem = ContentItemModel(
    id: 'pdf-test-1',
    title: 'كتاب التوحيد',
    description: 'متن كتاب التوحيد',
    type: AppConstants.typePdf,
    url: 'assets/sample.pdf',
    author: 'الإمام المجدد',
    pageCount: 120,
  );

  group('PdfViewerScreen Widget Tests', () {
    testWidgets('renders PDF title, jump button, and page indicator', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Directionality(
            textDirection: TextDirection.rtl,
            child: PdfViewerScreen(item: testPdfItem, isTestMode: true),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('كتاب التوحيد'), findsWidgets);
      expect(find.byIcon(Icons.bookmark_border_rounded), findsOneWidget);
      expect(find.textContaining('صفحة 1 من 120'), findsOneWidget);
    });
  });
}
