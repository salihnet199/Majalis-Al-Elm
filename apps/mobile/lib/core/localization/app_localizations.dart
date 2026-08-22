import 'package:flutter/material.dart';

class AppLocalizations {
  final Locale locale;

  AppLocalizations(this.locale);

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations) ??
        AppLocalizations(const Locale('ar'));
  }

  static const _localizedValues = <String, Map<String, String>>{
    'ar': {
      'app_name': 'مجالس العالم',
      'welcome_title': 'مرحباً بك في مجالس العالم',
      'welcome_subtitle': 'المنصة العلمية لدروس وفتاوى فضيلة الشيخ علي الويسي',
      'login': 'تسجيل الدخول',
      'register': 'إنشاء حساب جديد',
      'email': 'البريد الإلكتروني',
      'password': 'كلمة المرور',
      'full_name': 'الاسم الكامل',
      'or_continue_with': 'أو المتابعة عبر',
      'nav_home': 'الرئيسية',
      'nav_audio': 'الصوتيات',
      'nav_books': 'الكتب',
      'nav_articles': 'المقالات',
      'nav_downloads': 'المحفوظات',
      'nav_profile': 'حسابي',
      'search_placeholder': 'ابحث في المواد والمقالات...',
      'offline_ready': 'متاح بدون إنترنت',
      'download': 'تنزيل',
      'downloading': 'جاري التنزيل...',
      'downloaded': 'تم الحفظ',
      'delete': 'حذف',
      'logout': 'تسجيل الخروج',
      'logout_confirm': 'هل أنت متأكد من رغبتك في تسجيل الخروج؟',
      'settings': 'الإعدادات',
      'theme': 'المظهر',
      'language': 'اللغة',
      'retry': 'إعادة المحاولة',
      'empty_content': 'لا يوجد محتوى متاح حالياً',
      'error_occurred': 'حدث خطأ غير متوقع',
    },
    'en': {
      'app_name': 'Majlis Al-Alim',
      'welcome_title': 'Welcome to Majlis Al-Alim',
      'welcome_subtitle': 'Scientific Platform of Sheikh Ali Al-Waisi',
      'login': 'Sign In',
      'register': 'Create Account',
      'email': 'Email Address',
      'password': 'Password',
      'full_name': 'Full Name',
      'or_continue_with': 'Or continue with',
      'nav_home': 'Home',
      'nav_audio': 'Audio',
      'nav_books': 'Books',
      'nav_articles': 'Articles',
      'nav_downloads': 'Downloads',
      'nav_profile': 'Profile',
      'search_placeholder': 'Search content & articles...',
      'offline_ready': 'Available Offline',
      'download': 'Download',
      'downloading': 'Downloading...',
      'downloaded': 'Saved',
      'delete': 'Delete',
      'logout': 'Sign Out',
      'logout_confirm': 'Are you sure you want to sign out?',
      'settings': 'Settings',
      'theme': 'Theme',
      'language': 'Language',
      'retry': 'Retry',
      'empty_content': 'No content available',
      'error_occurred': 'An unexpected error occurred',
    },
  };

  String translate(String key) {
    return _localizedValues[locale.languageCode]?[key] ??
        _localizedValues['ar']?[key] ??
        key;
  }

  String get appName => translate('app_name');
  String get welcomeTitle => translate('welcome_title');
  String get welcomeSubtitle => translate('welcome_subtitle');
  String get login => translate('login');
  String get register => translate('register');
  String get email => translate('email');
  String get password => translate('password');
  String get fullName => translate('full_name');
  String get orContinueWith => translate('or_continue_with');
  String get navHome => translate('nav_home');
  String get navAudio => translate('nav_audio');
  String get navBooks => translate('nav_books');
  String get navArticles => translate('nav_articles');
  String get navDownloads => translate('nav_downloads');
  String get navProfile => translate('nav_profile');
  String get searchPlaceholder => translate('search_placeholder');
  String get offlineReady => translate('offline_ready');
  String get download => translate('download');
  String get downloading => translate('downloading');
  String get downloaded => translate('downloaded');
  String get delete => translate('delete');
  String get logout => translate('logout');
  String get logoutConfirm => translate('logout_confirm');
  String get settings => translate('settings');
  String get theme => translate('theme');
  String get language => translate('language');
  String get retry => translate('retry');
  String get emptyContent => translate('empty_content');
  String get errorOccurred => translate('error_occurred');
}

class AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => ['ar', 'en'].contains(locale.languageCode);

  @override
  Future<AppLocalizations> load(Locale locale) async {
    return AppLocalizations(locale);
  }

  @override
  bool shouldReload(AppLocalizationsDelegate old) => false;
}
