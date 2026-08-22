import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/notifications/domain/models/notification_preferences_model.dart';
import 'package:mobile/features/notifications/presentation/controllers/notifications_controller.dart';
import 'package:mobile/features/notifications/presentation/settings/notification_settings_screen.dart';

void main() {
  testWidgets('NotificationSettingsScreen renders switches for all categories', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          notificationPreferencesProvider.overrideWith(
            (ref) => NotificationPreferencesNotifier(ref.watch(apiClientProvider))
              ..state = const AsyncValue.data(NotificationPreferencesModel()),
          ),
        ],
        child: const MaterialApp(
          home: NotificationSettingsScreen(),
        ),
      ),
    );

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Verify AppBar Title
    expect(find.text('تفضيلات الإشعارات والتنبيهات'), findsOneWidget);

    // Verify Categories and Channels
    expect(find.text('إشعارات الدروس والمحاضرات العلمية'), findsOneWidget);
    expect(find.text('إشعارات الفتاوى والاستشارات الشرعية'), findsOneWidget);
    expect(find.text('الإعلانات العامة وتنبيهات المنصة'), findsOneWidget);
    expect(find.text('إشعارات الهاتف الفورية (Push Notifications)'), findsOneWidget);
  });
}
