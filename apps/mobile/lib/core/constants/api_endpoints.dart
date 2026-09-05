import 'package:flutter/foundation.dart';

class ApiEndpoints {
  ApiEndpoints._();

  // Compile-time override for CI/release builds. When omitted, local development
  // uses the correct host for the current Flutter target instead of sending an
  // Android emulator to its own localhost.
  static const String _configuredBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  static String get baseUrl {
    if (_configuredBaseUrl.trim().isNotEmpty) {
      return _configuredBaseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    }
    if (kIsWeb) return 'http://localhost:3000/api/v1';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'http://10.0.2.2:3000/api/v1';
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
      case TargetPlatform.windows:
      case TargetPlatform.linux:
        return 'http://localhost:3000/api/v1';
      case TargetPlatform.fuchsia:
        return 'http://localhost:3000/api/v1';
    }
  }

  // BC01: Identity & Auth
  static const String registerEmail = '/auth/register/email';
  static const String loginEmail = '/auth/login/email';
  static const String refreshToken = '/auth/token/refresh';
  static const String logout = '/auth/logout';
  static const String changePassword = '/auth/change-password';
  static const String userMe = '/auth/users/me';

  static const String registerPhoneInitiate = '/auth/register/phone/initiate';
  static const String registerPhoneVerify = '/auth/register/phone/verify';
  static const String loginPhoneInitiate = '/auth/login/phone/initiate';
  static const String loginPhoneVerify = '/auth/login/phone/verify';
  static const String loginGoogle = '/auth/login/google';
  static const String loginApple = '/auth/login/apple';
  static const String loginFacebook = '/auth/login/facebook';

  // BC02: Content
  static const String contentList = '/content';
  static String contentDetail(String slug) => '/content/$slug';
  static String contentMediaStream(String slug) => '/content/$slug/media/stream';
  static const String categories = '/content/categories';
  static const String tags = '/content/tags';
}
