import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../localization/lang_provider.dart';

class AppColors {
  AppColors._();

  static const Color background = Color(0xFFFAF6F1);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceWarm = Color(0xFFF5EDE3);
  static const Color primary = Color(0xFFC4622D);
  static const Color primaryLight = Color(0xFFD4784A);
  static const Color onPrimary = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF2D1506);
  static const Color textSecondary = Color(0xFF8B6355);
  static const Color textMuted = Color(0xFFB8A499);
  static const Color border = Color(0xFFE8DED5);
  static const Color searchBg = Color(0xFFEEE6DC);
  static const Color critical = Color(0xFFD94040);
  static const Color chipActive = Color(0xFFC4622D);
  static const Color chipInactive = Color(0xFFFFFFFF);
  static const Color navBg = Color(0xFFFFFFFF);
  static const Color sectionLine = Color(0xFFD4A574);
  static const Color sectionLineGreen = Color(0xFF2D8B6F);
}

class AppRadius {
  AppRadius._();
  static const double card = 16;
  static const double sheet = 24;
  static const double chip = 999;
  static const double image = 14;
}

class AppSpacing {
  AppSpacing._();
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
}

class AppTheme {
  AppTheme._();

  static ThemeData light(Lang lang) {
    final isArabic = lang == Lang.ar;
    // Cairo has full Arabic glyph coverage; DM Sans/Playfair Display don't,
    // so Arabic mode uses Cairo throughout instead of the English display pairing.
    final bodyFont = isArabic ? GoogleFonts.cairo : GoogleFonts.dmSans;
    final headlineFont = isArabic ? GoogleFonts.cairo : GoogleFonts.playfairDisplay;

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        primary: AppColors.primary,
        surface: AppColors.surface,
        error: AppColors.critical,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: AppColors.background,
    );

    final baseTextTheme = isArabic
        ? GoogleFonts.cairoTextTheme(base.textTheme)
        : GoogleFonts.dmSansTextTheme(base.textTheme);

    final textTheme = baseTextTheme.copyWith(
      headlineLarge: headlineFont(
        fontSize: 26,
        fontWeight: FontWeight.w800,
        color: AppColors.textPrimary,
      ),
      headlineMedium: headlineFont(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
      ),
      headlineSmall: headlineFont(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
      ),
      bodyLarge: bodyFont(
        fontSize: 16,
        color: AppColors.textPrimary,
      ),
      bodyMedium: bodyFont(
        fontSize: 14,
        color: AppColors.textSecondary,
      ),
      bodySmall: bodyFont(
        fontSize: 12,
        color: AppColors.textMuted,
      ),
      labelLarge: bodyFont(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: AppColors.textPrimary,
      ),
    );

    return base.copyWith(
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          shape: const StadiumBorder(),
          textStyle: bodyFont(fontSize: 15, fontWeight: FontWeight.w600),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primary,
          side: BorderSide(color: AppColors.border),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
          shape: const StadiumBorder(),
          textStyle: bodyFont(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        elevation: 2,
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: AppColors.primary,
        unselectedLabelColor: AppColors.textMuted,
        indicatorColor: AppColors.primary,
        indicatorSize: TabBarIndicatorSize.tab,
        labelStyle: bodyFont(fontWeight: FontWeight.w600, fontSize: 15),
        unselectedLabelStyle: bodyFont(fontWeight: FontWeight.w400, fontSize: 15),
        dividerColor: AppColors.border,
      ),
    );
  }
}
