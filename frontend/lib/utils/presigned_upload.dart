import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// How long one photo may take to reach storage. A 1600 px JPEG is a few
/// hundred KB, so this is generous for a slow mobile link while never leaving
/// the user on a spinner that cannot end.
const presignedUploadTimeout = Duration(seconds: 45);

/// PUTs [bytes] to a presigned storage URL. Returns true on a 2xx; false when
/// the upload is rejected, errors, or stalls past [timeout].
///
/// Every caller already treats false as "this photo failed" and lets the user
/// retry. Before this existed each caller awaited a bare `http.put` with no
/// timeout, so a connection that stopped answering mid-upload left the submit
/// button spinning forever. The client is closed on the way out, which also
/// abandons the stalled socket.
Future<bool> putToPresignedUrl(
  String url,
  Uint8List bytes,
  String contentType, {
  Duration timeout = presignedUploadTimeout,
  http.Client? client,
}) async {
  final c = client ?? http.Client();
  try {
    final response = await c
        .put(Uri.parse(url), headers: {'Content-Type': contentType}, body: bytes)
        .timeout(timeout);
    return response.statusCode >= 200 && response.statusCode < 300;
  } on TimeoutException {
    debugPrint('putToPresignedUrl: no response after ${timeout.inSeconds}s');
    return false;
  } on http.ClientException catch (e) {
    debugPrint('putToPresignedUrl: $e');
    return false;
  } on SocketException catch (e) {
    debugPrint('putToPresignedUrl: $e');
    return false;
  } finally {
    if (client == null) c.close();
  }
}
