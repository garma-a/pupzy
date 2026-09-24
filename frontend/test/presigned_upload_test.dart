import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pupzy/utils/presigned_upload.dart';

void main() {
  final bytes = Uint8List.fromList([1, 2, 3]);

  test('a 2xx response is a successful upload', () async {
    final client = MockClient((request) async {
      expect(request.method, 'PUT');
      expect(request.headers['Content-Type'], 'image/jpeg');
      return http.Response('', 200);
    });
    expect(await putToPresignedUrl('https://storage.test/x', bytes, 'image/jpeg', client: client), isTrue);
  });

  test('a rejected upload reports failure', () async {
    final client = MockClient((_) async => http.Response('SignatureDoesNotMatch', 403));
    expect(await putToPresignedUrl('https://storage.test/x', bytes, 'image/jpeg', client: client), isFalse);
  });

  test('a network error reports failure instead of throwing', () async {
    final client = MockClient((_) async => throw http.ClientException('connection reset'));
    expect(await putToPresignedUrl('https://storage.test/x', bytes, 'image/jpeg', client: client), isFalse);
  });

  // Regression: uploads used to await http.put with no timeout, so a server
  // that stopped answering left the submit button spinning forever.
  test('a stalled upload gives up after the timeout', () async {
    final never = Completer<http.Response>();
    final client = MockClient((_) => never.future);
    final started = DateTime.now();
    final ok = await putToPresignedUrl(
      'https://storage.test/x',
      bytes,
      'image/jpeg',
      client: client,
      timeout: const Duration(milliseconds: 200),
    );
    expect(ok, isFalse);
    expect(DateTime.now().difference(started), lessThan(const Duration(seconds: 2)));
  });
}
