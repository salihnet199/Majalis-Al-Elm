import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/notifications/presentation/inbox/notification_inbox_screen.dart';

void main() {
  testWidgets('NotificationInboxScreen renders title and notification elements', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: NotificationInboxScreen(),
        ),
      ),
    );

    // Pump a single frame
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // Verify AppBar Title
    expect(find.text('مركز الإشعارات والتنبيهات'), findsOneWidget);

    // Verify Settings button
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget);
  });
}
