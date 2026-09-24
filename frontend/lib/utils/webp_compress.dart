import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_image_compress/flutter_image_compress.dart';

/// Decodes [bytes] just far enough to read its actual pixel dimensions.
Future<(int width, int height)> decodedDimensions(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  final frame = await codec.getNextFrame();
  final size = (frame.image.width, frame.image.height);
  frame.image.dispose();
  codec.dispose();
  return size;
}

/// Compresses a picked image down to static WebP that fits both a byte
/// budget and a pixel-dimension cap on each side — the same shape the
/// backend enforces for comment images and profile photos alike (see
/// `comment-image.validator.ts` / `profile-photo-flutter-integration-
/// contract.md`). Returns null if compression isn't achievable (e.g.
/// unsupported platform) so the caller can skip/report gracefully.
///
/// `compressWithFile`'s `minWidth`/`minHeight` are NOT a hard ceiling on
/// their own: the plugin picks `scale = min(srcW/minWidth, srcH/minHeight)`,
/// so for any non-square source (i.e. virtually every real camera photo)
/// only the axis needing *less* shrinking is guaranteed to land at the
/// target — the other axis can still come out larger. Passing the same
/// value for both only reliably works for square sources. So every
/// attempt's actual output is re-decoded and measured here rather than
/// trusted from the input parameters, and the retry loop keeps shrinking
/// until it's verified to actually fit — this is what makes the guarantee
/// real instead of aspirational.
Future<Uint8List?> compressToWebpUnderLimit(
  XFile file, {
  int maxBytes = 100000,
  int maxSide = 480,
}) async {
  try {
    int quality = 80;
    int minSide = maxSide;
    final maxPixels = maxSide * maxSide;
    for (var attempt = 0; attempt < 8; attempt++) {
      final result = await FlutterImageCompress.compressWithFile(
        file.path,
        format: CompressFormat.webp,
        quality: quality,
        minWidth: minSide,
        minHeight: minSide,
      );
      if (result == null) return null;
      if (result.lengthInBytes <= maxBytes) {
        final (width, height) = await decodedDimensions(result);
        if (width <= maxSide && height <= maxSide && width * height <= maxPixels) {
          return result;
        }
      }
      quality = (quality - 12).clamp(20, 100);
      minSide = (minSide * 0.75).round();
      if (minSide < 16) return null;
    }
    return null;
  } catch (_) {
    return null;
  }
}
