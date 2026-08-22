import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/presentation/text/article_reader_screen.dart';

void main() {
  const testArticleItem = ContentItemModel(
    id: 'text-test-1',
    title: 'منزلة الصلاة في الإسلام',
    description: 'مقال تأصيلي',
    type: AppConstants.typeText,
    url: '',
    author: 'قسم البحوث',
    textContent: 'إن الصلاة هي الركن الثاني من أركان الإسلام بعد الشهادتين، وهي عمود الدين.',
  );

  group('ArticleReaderScreen Widget Tests', () {
    testWidgets('renders article title, author, Amiri badge, and text content', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Directionality(
            textDirection: TextDirection.rtl,
            child: ArticleReaderScreen(item: testArticleItem),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('قراءة المقال'), findsOneWidget);
      expect(find.text('منزلة الصلاة في الإسلام'), findsOneWidget);
      expect(find.text('قسم البحوث'), findsOneWidget);
      expect(find.text('خط Amiri الأصيل'), findsOneWidget);
      expect(find.textContaining('إن الصلاة هي الركن الثاني'), findsOneWidget);
    });

    testWidgets('changes font size when clicking A+ / A- buttons', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Directionality(
            textDirection: TextDirection.rtl,
            child: ArticleReaderScreen(item: testArticleItem),
          ),
        ),
      );

      await tester.pump();

      // Tap increase font size
      await tester.tap(find.byIcon(Icons.text_increase_rounded));
      await tester.pump();

      // Verify SelectableText style has increased font size (from 18 to 20)
      final textWidget = tester.widget<SelectableText>(find.byType(SelectableText));
      expect(textWidget.style?.fontSize, 20.0);
    });
  });
}
