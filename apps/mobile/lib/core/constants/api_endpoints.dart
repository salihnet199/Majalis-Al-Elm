class ApiEndpoints {
  ApiEndpoints._();

  // Base URL (env-configurable with localhost fallback)
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  // BC01: Identity & Auth
  static const String registerEmail = '/auth/register/email';
  static const String loginEmail = '/auth/login/email';
  static const String refreshToken = '/auth/token/refresh';
  static const String logout = '/auth/logout';
  static const String changePassword = '/auth/change-password';
  static const String userMe = '/auth/users/me';

  // Auth (Phase 2 scope - Future endpoints per API-DESIGN.md)
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
