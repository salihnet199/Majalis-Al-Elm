class AppConstants {
  AppConstants._();

  static const String appName = 'مجالس العالم';
  static const String appEnglishName = 'Majlis Al-Alim';
  static const String sheikhName = 'فضيلة الشيخ علي الويسي';

  // Secure Storage Keys
  static const String keyAccessToken = 'auth_access_token';
  static const String keyRefreshToken = 'auth_refresh_token';
  static const String keyUserId = 'auth_user_id';
  static const String keyUserRole = 'auth_user_role';

  // Network timeouts
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 15);

  // Content Types (Fixed Scope - 4 types only)
  static const String typeAudio = 'AUDIO';
  static const String typePdf = 'PDF';
  static const String typeText = 'TEXT';
  static const String typeImage = 'IMAGE';
}
