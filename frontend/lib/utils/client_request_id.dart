import 'dart:math';

final Random _rng = Random();

/// Generates a durable, author-scoped idempotency key for createComment /
/// createReply. Doesn't need to be a real UUID — just unique enough per
/// device+moment that a retried request (e.g. after a dropped connection)
/// reuses the same key and the backend can dedupe it, while two different
/// taps never collide.
String generateClientRequestId() {
  final millis = DateTime.now().microsecondsSinceEpoch;
  final salt = _rng.nextInt(1 << 32).toRadixString(16).padLeft(8, '0');
  return 'pupzy-$millis-$salt';
}
