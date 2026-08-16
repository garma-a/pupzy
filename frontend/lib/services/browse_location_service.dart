import 'package:flutter/foundation.dart';

/// Lets the user browse posts in a city other than their real location —
/// mirrors the "Cairo, Egypt" area picker pattern common in classifieds apps.
///
/// `null` means "use my real location" (GPS / home city, as before).
/// Once set, feed screens use this city's governorate/id directly and skip
/// GPS entirely — the distance filter then re-centers around this city
/// instead of the viewer's actual position.
class BrowseLocationService extends ChangeNotifier {
  Map<String, dynamic>? _selectedCity;

  Map<String, dynamic>? get selectedCity => _selectedCity;

  void setCity(Map<String, dynamic>? city) {
    if (_selectedCity == city) return;
    _selectedCity = city;
    notifyListeners();
  }

  void clear() => setCity(null);
}
