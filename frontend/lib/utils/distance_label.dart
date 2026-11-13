import 'dart:ui' show FontFeature;

import 'package:intl/intl.dart';

final _wholeKm = NumberFormat.decimalPattern('en');

/// A distance for display: one decimal under 10 km ("2.4"), whole kilometres
/// with thousands separators from 10 km up ("843", "1,204"). Far posts
/// don't need the decimal, and "843.0" reads as noise.
String formatDistanceKm(double km) => km < 10 ? km.toStringAsFixed(1) : _wholeKm.format(km.round());

/// Even-width digits, so distances line up and don't jiggle between cards.
const distanceFontFeatures = [FontFeature.tabularFigures()];
