import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  // Primary — Heritage Mocha Brown & Antique Gold (الهوية البصرية الجديدة، قرار 2026-08-24)
  // ملاحظة: الأخضر #1B4332 كان الهوية القديمة — أُستبدل بالكامل
  static const Color primary = mocha800;      // #2D1F18 — البني الدافئ الرئيسي
  static const Color primaryLight = gold500;  // #D4AF37 — الذهبي للـaccents الفاتحة
  static const Color primaryDark = mocha950;  // #1A120D — الموكا العميق للخلفيات
  // Secondary - Accent Gold
  static const Color secondary = Color(0xFFD4AF37);
  static const Color secondaryLight = Color(0xFFF3E5AB);
  static const Color secondaryDark = Color(0xFFAA820A);

  // Neutral Backgrounds & Surfaces (Light)
  static const Color bgLight = Color(0xFFF8F9FA);
  static const Color surfaceLight = Colors.white;
  static const Color textPrimaryLight = Color(0xFF1E293B);
  static const Color textSecondaryLight = Color(0xFF64748B);
  static const Color borderLight = Color(0xFFE2E8F0);

  // Neutral Backgrounds & Surfaces (Dark)
  static const Color bgDark = Color(0xFF0F172A);
  static const Color surfaceDark = Color(0xFF1E293B);
  static const Color textPrimaryDark = Color(0xFFF8FAFC);
  static const Color textSecondaryDark = Color(0xFF94A3B8);
  static const Color borderDark = Color(0xFF334155);

  // Semantic Status Colors
  static const Color success = Color(0xFF10B981);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF3B82F6);

  // ألوان تصنيف الإشعارات (Notification Category Accents)
  // 'درس علمي' يستخدم gold500 أدناه — هذان اللونان الإضافيان لتمييز
  // الفتوى والإعلان العام بصريًا، خارج نطاق لوحة موكا/ذهبي الأساسية عمدًا.
  static const Color categoryFatwa = Color(0xFF06B6D4);
  static const Color categoryAnnouncement = Color(0xFFA855F7);

  // Warm Heritage Gold & Mocha Palette
  static const Color gold500 = Color(0xFFD4AF37);
  static const Color gold400 = Color(0xFFE5C158);
  static const Color gold300 = Color(0xFFF5E6BE);
  static const Color mocha950 = Color(0xFF1A120D);
  static const Color mocha900 = Color(0xFF231812);
  static const Color mocha850 = Color(0xFF281C15);
  static const Color mocha800 = Color(0xFF2D1F18);
  static const Color mocha700 = Color(0xFF36251D);
  static const Color mocha400 = Color(0xFF755443);
  static const Color cream50 = Color(0xFFFDFBF7);
  static const Color cream100 = Color(0xFFF7F2EA);
  static const Color cream200 = Color(0xFFEBE2D3);
  static const Color cream300 = Color(0xFFC5B8A5);
  static const Color cream400 = Color(0xFF968978);
}
