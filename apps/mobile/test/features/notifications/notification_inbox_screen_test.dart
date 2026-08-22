import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/notifications/presentation/inbox/notification_inbox_screen.dart';

class _MockApiClient extends Mock implements ApiClient {}

void main() {
  late _MockApiClient apiClient;

  setUp(() {
    apiClient = _MockApiClient();
  });

  Widget buildTestableWidget() {
    return ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(apiClient)],
      child: const MaterialApp(home: NotificationInboxScreen()),
    );
  }

  testWidgets('NotificationInboxScreen renders title and settings action', (tester) async {
    when(() => apiClient.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/notifications'),
        data: {'data': []},
      ),
    );

    await tester.pumpWidget(buildTestableWidget());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('مركز الإشعارات والتنبيهات'), findsOneWidget);
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget);
  });

  testWidgets('renders the empty state when the backend returns no notifications', (tester) async {
    when(() => apiClient.get(any())).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/notifications'),
        data: {'data': []},
      ),
    );

    await tester.pumpWidget(buildTestableWidget());
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('لا توجد إشعارات حالياً'), findsOneWidget);
  });

  testWidgets(
    'SECURITY: a failed request renders an Arabic error — never fabricated notifications',
    (tester) async {
      when(() => apiClient.get(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/notifications'),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(buildTestableWidget());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      // The Arabic failure state is visible...
      expect(find.text('تعذر تحميل الإشعارات'), findsOneWidget);
      expect(find.text('تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت'), findsOneWidget);
      expect(find.text('إعادة المحاولة'), findsOneWidget);

      // ...and none of the previously hardcoded sample notifications appear.
      expect(find.text('بدء التسجيل في دورة شرح العقيدة الطحاوية'), findsNothing);
      expect(find.text('جديد الفتاوى: حكم الجمع في السفر العارض'), findsNothing);
      expect(find.text('لا توجد إشعارات حالياً'), findsNothing);
    },
  );
}
