import 'dart:math';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

sealed class CommentImageResult {
  const CommentImageResult();
}

class CommentImageSuccess extends CommentImageResult {
  final Uint8List bytes;
  final int width;
  final int height;

  const CommentImageSuccess({
    required this.bytes,
    required this.width,
    required this.height,
  });
}

class CommentImageFailure extends CommentImageResult {
  final String messageEn;
  final String messageAr;

  const CommentImageFailure(this.messageEn, this.messageAr);
}

class CommentImageCompressor {
  CommentImageCompressor._();

  /// Decodes, sanitizes, scales, and encodes [rawBytes] into a valid static WebP
  /// fitting within the authoritative 100,000 byte limit and max 480px longest edge.
  static CommentImageResult compress(Uint8List rawBytes) {
    final img.Image? decoded = img.decodeImage(rawBytes);
    if (decoded == null) {
      return const CommentImageFailure(
        'Unsupported or corrupt image format.',
        'صيغة الصورة غير مدعومة أو تالفة.',
      );
    }

    // Strip forbidden metadata
    decoded.exif.clear();
    decoded.textData?.clear();

    // Dimensions: bound longest edge to 480, preserve aspect ratio, never upscale
    final int longest = max(decoded.width, decoded.height);
    img.Image resized = decoded;

    if (longest > 480) {
      int w;
      int h;
      if (decoded.width >= decoded.height) {
        w = 480;
        h = max(1, (decoded.height * 480 / decoded.width).round());
      } else {
        h = 480;
        w = max(1, (decoded.width * 480 / decoded.height).round());
      }
      resized = img.copyResize(
        decoded,
        width: w,
        height: h,
        interpolation: img.Interpolation.linear,
      );
    }

    // Progressive quality reduction to fit within 100,000 bytes
    // First try direct WebP encoding at full fidelity
    final Uint8List directWebP = img.encodeWebP(resized);
    if (directWebP.length <= 100000) {
      return CommentImageSuccess(
        bytes: directWebP,
        width: resized.width,
        height: resized.height,
      );
    }

    // If initial WebP exceeds 100,000 bytes, iteratively reduce quality via DCT quantization
    const List<int> qualities = [85, 75, 65, 50, 35, 20];
    for (final int q in qualities) {
      final Uint8List lossyJpg = img.encodeJpg(resized, quality: q);
      final img.Image? quantized = img.decodeImage(lossyJpg);
      if (quantized != null) {
        final Uint8List encoded = img.encodeWebP(quantized);
        if (encoded.length <= 100000) {
          return CommentImageSuccess(
            bytes: encoded,
            width: resized.width,
            height: resized.height,
          );
        }
      }
    }

    return const CommentImageFailure(
      'Image exceeds 100 KB limit after compression. Please select a smaller or simpler photo.',
      'حجم الصورة يتجاوز 100 كيلوبايت بعد الضغط. يرجى اختيار صورة أصغر أو أبسط.',
    );
  }
}
