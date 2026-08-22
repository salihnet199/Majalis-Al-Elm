import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/app_constants.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/content/domain/models/content_item_model.dart';
import 'package:mobile/features/content/presentation/image/image_viewer_screen.dart';

void main() {
  const testImageItem = ContentItemModel(
    id: 'image-test-1',
    title: 'إنفوجرافيك أركان الصلاة',
    description: 'رسم توضيحي تفصيلي',
    type: AppConstants.typeImage,
    url: 'https://example.com/test.png',
    author: 'الفريق الإعلامي',
  );

  group('ImageViewerScreen Widget Tests', () {
    testWidgets('renders title, author, and InteractiveViewer widget', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Directionality(
            textDirection: TextDirection.rtl,
            child: ImageViewerScreen(item: testImageItem),
          ),
        ),
      );

      await tester.pump();

      expect(find.text('إنفوجرافيك أركان الصلاة'), findsWidgets);
      expect(find.text('إعداد: الفريق الإعلامي'), findsOneWidget);
      expect(find.byType(InteractiveViewer), findsOneWidget);
    });

    testWidgets('toggles info overlay when info button tapped', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Directionality(
            textDirection: TextDirection.rtl,
            child: ImageViewerScreen(item: testImageItem),
          ),
        ),
      );

      await tester.pump();
      expect(find.text('إعداد: الفريق الإعلامي'), findsOneWidget);

      // Tap info toggle button
      await tester.tap(find.byIcon(Icons.info_rounded));
      await tester.pump();

      // Info overlay should now be hidden
      expect(find.text('إعداد: الفريق الإعلامي'), findsNothing);
    });
  });
}
