import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// Resolves the device's GPS position once per app session and shares it
/// across screens, so switching tabs doesn't re-pay for a fresh GPS fix
/// every time.
class LocationService extends ChangeNotifier {
  Position? _position;
  Future<Position?>? _inFlight;

  Position? get position => _position;

  /// Returns the cached position if already resolved (or a fetch already
  /// in flight); otherwise resolves it once and caches the result.
  Future<Position?> resolve() {
    if (_position != null) return Future.value(_position);
    return _inFlight ??= _fetch();
  }

  Future<Position?> _fetch() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return null;
      }
      // Instant, OS-cached location first — avoids waiting on a fresh GPS fix.
      _position = await Geolocator.getLastKnownPosition();
      _position ??= await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 6)),
      );
    } catch (_) {
      // Location is optional — callers fall back to governorate/city-only filtering.
    }
    notifyListeners();
    return _position;
  }
}
