import 'dart:math';

final Random _rng = Random();

/// Generates a durable, client-scoped idempotency/progress key \u2014 doesn't
/// need to be a real UUID, just unique enough per device+moment that a
/// retried request reuses the same key. Used as the `progressToken` for
/// account deletion so progress can still be queried (unauthenticated)
/// even if the original response never arrives.
String generateClientRequestId() {
  final millis = DateTime.now().microsecondsSinceEpoch;
  final salt = _rng.nextInt(1 << 32).toRadixString(16).padLeft(8, '0');
  return 'pupzy-$millis-$salt';
}
