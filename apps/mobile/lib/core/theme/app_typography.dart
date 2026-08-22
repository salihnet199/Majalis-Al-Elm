import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTypography {
  AppTypography._();

  // Calligraphic typography using Aref Ruqaa (Strictly for Brand Name, Sheikh Name & Major Hero Headers)
  static TextStyle get brandTitle => GoogleFonts.arefRuqaa(
        fontSize: 26,
        fontWeight: FontWeight.bold,
        letterSpacing: 0,
        height: 1.3,
      );

  static TextStyle get sheikhName => GoogleFonts.arefRuqaa(
        fontSize: 20,
        fontWeight: FontWeight.bold,
        letterSpacing: 0,
        height: 1.3,
      );

  static TextStyle get heroHeader => GoogleFonts.arefRuqaa(
        fontSize: 28,
        fontWeight: FontWeight.bold,
        height: 1.4,
      );

  // Headings & UI typography using Cairo
  static TextStyle get displayLarge => GoogleFonts.cairo(
        fontSize: 32,
        fontWeight: FontWeight.bold,
        letterSpacing: 0,
      );

  static TextStyle get displayMedium => GoogleFonts.cairo(
        fontSize: 28,
        fontWeight: FontWeight.bold,
        letterSpacing: 0,
      );

  static TextStyle get titleLarge => GoogleFonts.cairo(
        fontSize: 22,
        fontWeight: FontWeight.w700,
      );

  static TextStyle get titleMedium => GoogleFonts.cairo(
        fontSize: 18,
        fontWeight: FontWeight.w600,
      );

  static TextStyle get titleSmall => GoogleFonts.cairo(
        fontSize: 16,
        fontWeight: FontWeight.w600,
      );

  static TextStyle get bodyLarge => GoogleFonts.cairo(
        fontSize: 16,
        fontWeight: FontWeight.normal,
        height: 1.5,
      );

  static TextStyle get bodyMedium => GoogleFonts.cairo(
        fontSize: 14,
        fontWeight: FontWeight.normal,
        height: 1.4,
      );

  static TextStyle get bodySmall => GoogleFonts.cairo(
        fontSize: 12,
        fontWeight: FontWeight.normal,
      );

  static TextStyle get labelLarge => GoogleFonts.cairo(
        fontSize: 14,
        fontWeight: FontWeight.w600,
      );

  // Long text, Articles & Quranic quotes typography using Amiri
  static TextStyle get articleTitle => GoogleFonts.amiri(
        fontSize: 24,
        fontWeight: FontWeight.bold,
        height: 1.6,
      );

  static TextStyle get articleBody => GoogleFonts.amiri(
        fontSize: 18,
        fontWeight: FontWeight.normal,
        height: 1.8,
      );

  static TextStyle get quranicText => GoogleFonts.amiri(
        fontSize: 22,
        fontWeight: FontWeight.bold,
        height: 2.0,
      );
}
