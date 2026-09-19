import 'package:flutter/foundation.dart';

/// Signals that the viewer's Block list changed. Blocking/unblocking changes
/// what the server returns from every feed, so feed screens watch [version]
/// and do a full reload when it moves — a quiet "patch existing rows" refresh
/// can never remove posts that vanished, which is exactly what a Block does.
class SafetyEvents extends ChangeNotifier {
  int _version = 0;
  int get version => _version;

  void blockListChanged() {
    _version++;
    notifyListeners();
  }
}
