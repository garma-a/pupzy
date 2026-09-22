import 'package:flutter/foundation.dart';

/// Signals that what the server returns for the feeds has changed, so feed
/// screens watch [version] and do a full reload when it moves. A quiet
/// "patch existing rows" refresh can never remove posts that vanished, which
/// is exactly what a Block, a closed post, or a deleted post does.
class SafetyEvents extends ChangeNotifier {
  int _version = 0;
  int get version => _version;

  /// The viewer blocked or unblocked an account.
  void blockListChanged() => _bump();

  /// A post was closed (resolved/reunited/adopted/sold) or deleted.
  void postsChanged() => _bump();

  void _bump() {
    _version++;
    notifyListeners();
  }
}
