import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/notifications/presentation/settings/notification_settings_screen.dart';

class _MockApiClient extends Mock implements ApiClient {}

void main() {
  late _MockApiClient apiClient;

  setUp(() {
    apiClient = _MockApiClient();
  });

  Widget buildTestableWidget() {
    return ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(apiClient)],
      child: const MaterialApp(home: NotificationSettingsScreen()),
    );
  }

  testWidgets('NotificationSettingsScreen renders switches for all categories', (tester) async {
    when(() => apiClient.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/notifications/preferences'),
        data: {
          'data': {
            'enableLessons': true,
            'enableFatwas': true,
            'enableAnnouncements': true,
            'enablePush': true,
          },
        },
      ),
    );

    await tester.pumpWidget(buildTestableWidget());
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

  testWidgets(
    'SECURITY: a failed request renders an Arabic error — never default preferences',
    (tester) async {
      when(() => apiClient.get(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/notifications/preferences'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت'), findsOneWidget);
      expect(find.text('إعادة المحاولة'), findsOneWidget);

      // No switch may be shown, because no real preference value is known.
      expect(find.text('إشعارات الدروس والمحاضرات العلمية'), findsNothing);
      expect(find.byType(SwitchListTile), findsNothing);
    },
  );
}
