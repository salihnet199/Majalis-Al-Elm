import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_typography.dart';

class AppTheme {
  AppTheme._();

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        // الهوية البصرية: بني موكا دافئ + ذهبي عتيق (قرار 2026-08-24)
        // AppColors.primary (أخضر #1B4332) كان الهوية القديمة — مُستبدَل
        primary: AppColors.mocha800,
        onPrimary: AppColors.gold400,
        primaryContainer: AppColors.cream100,
        onPrimaryContainer: AppColors.mocha950,
        secondary: AppColors.gold500,
        onSecondary: AppColors.mocha950,
        secondaryContainer: AppColors.gold300,
        onSecondaryContainer: AppColors.mocha800,
        surface: AppColors.cream50,
        onSurface: AppColors.mocha950,
        surfaceContainerHighest: AppColors.cream200,
        error: AppColors.error,
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: AppColors.cream100,
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.mocha800,
        foregroundColor: AppColors.gold400,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: AppTypography.brandTitle.copyWith(color: AppColors.gold400),
      ),
      cardTheme: CardThemeData(
        color: AppColors.cream50,
        elevation: 2,
        shadowColor: AppColors.mocha950.withAlpha((0.08 * 255).toInt()),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.cream200, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.mocha800,
          foregroundColor: AppColors.gold400,
          elevation: 2,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: AppTypography.labelLarge.copyWith(fontSize: 16),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.cream50,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.cream200),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.cream200),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.gold500, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.error),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        hintStyle: const TextStyle(color: AppColors.cream400),
      ),
    );
  }

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        // Dark: موكا عميق + ذهبي ساطع
        primary: AppColors.gold500,
        onPrimary: AppColors.mocha950,
        primaryContainer: AppColors.mocha800,
        onPrimaryContainer: AppColors.gold300,
        secondary: AppColors.gold400,
        onSecondary: AppColors.mocha950,
        secondaryContainer: AppColors.mocha700,
        onSecondaryContainer: AppColors.gold300,
        surface: AppColors.mocha900,
        onSurface: AppColors.cream100,
        surfaceContainerHighest: AppColors.mocha800,
        error: AppColors.error,
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: AppColors.mocha950,
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.mocha900,
        foregroundColor: AppColors.gold400,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: AppTypography.brandTitle.copyWith(color: AppColors.gold400),
      ),
      cardTheme: CardThemeData(
        color: AppColors.mocha900,
        elevation: 3,
        shadowColor: Colors.black.withAlpha((0.4 * 255).toInt()),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: AppColors.gold500.withAlpha((0.2 * 255).toInt()), width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.gold500,
          foregroundColor: AppColors.mocha950,
          elevation: 2,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: AppTypography.labelLarge.copyWith(fontSize: 16, fontWeight: FontWeight.bold),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.mocha900,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppColors.gold500.withAlpha((0.3 * 255).toInt())),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppColors.gold500.withAlpha((0.25 * 255).toInt())),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.gold500, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.error),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        hintStyle: const TextStyle(color: AppColors.cream400),
      ),
    );
  }
}
