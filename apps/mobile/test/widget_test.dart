import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/main.dart';
import 'package:mobile/core/storage/secure_storage_service.dart';
import 'package:mobile/features/auth/data/repositories/auth_repository.dart';
import 'package:mobile/features/auth/providers/auth_notifier.dart';
import 'package:mobile/features/auth/providers/auth_state.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';

void main() {
  testWidgets('MajalisAlElmApp renders login when unauthenticated and enforces RTL Directionality', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authNotifierProvider.overrideWith((ref) => MockAuthNotifier(const Unauthenticated())),
        ],
        child: const MajalisAlElmApp(),
      ),
    );

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Verify Login Screen is displayed
    expect(find.widgetWithText(ElevatedButton, 'تسجيل الدخول'), findsOneWidget);

    // Verify Directionality is RTL
    final directionality = tester.widget<Directionality>(find.byType(Directionality).first);
    expect(directionality.textDirection, TextDirection.rtl);
  });

  testWidgets('MajalisAlElmApp transitions to home when authenticated', (WidgetTester tester) async {
    const testUser = UserModel(
      id: '01920abc-1234-7890-abcd-000000000001',
      fullName: 'أحمد محمد',
      email: 'ahmed@example.com',
      role: 'User',
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authNotifierProvider.overrideWith((ref) => MockAuthNotifier(const Authenticated(testUser))),
        ],
        child: const MajalisAlElmApp(),
      ),
    );

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('أحدث المواد المنشورة'), findsOneWidget);
  });
}

class MockAuthNotifier extends StateNotifier<AuthState> implements AuthNotifier {
  MockAuthNotifier(super.state);

  @override
  IAuthRepository get repository => throw UnimplementedError();

  @override
  SecureStorageService get secureStorage => throw UnimplementedError();

  @override
  Future<void> checkAuthStatus() async {}

  @override
  Future<bool> loginWithEmail({required String email, required String password}) async => true;

  @override
  Future<bool> registerWithEmail({required String fullName, required String email, required String password}) async => true;

  @override
  Future<bool> loginWithGoogle({required String idToken, String? fullName, String? email}) async => true;

  @override
  Future<bool> loginWithApple({required String idToken, String? fullName, String? email}) async => true;


  @override
  Future<void> logout() async {
    state = const Unauthenticated();
  }

  @override
  void handleSessionExpired() {
    state = const Unauthenticated();
  }
}
