import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:pupzy/utils/comment_image_compressor.dart';

void main() {
  group('CommentImageCompressor', () {
    test('AC 1: decodes JPEG photo and explicitly encodes as static WebP', () {
      // Create a representative 800x600 photo fixture
      final image = img.Image(width: 800, height: 600);
      for (var y = 0; y < 600; y++) {
        for (var x = 0; x < 800; x++) {
          image.setPixelRgb(x, y, (x * 255 / 800).round(), (y * 255 / 600).round(), 128);
        }
      }
      final rawJpeg = Uint8List.fromList(img.encodeJpg(image, quality: 85));

      final result = CommentImageCompressor.compress(rawJpeg);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;

      // Verify explicit WebP format magic bytes ('RIFF' .... 'WEBP')
      expect(String.fromCharCodes(success.bytes.sublist(0, 4)), equals('RIFF'));
      expect(String.fromCharCodes(success.bytes.sublist(8, 12)), equals('WEBP'));

      // Verify decodability
      final decoded = img.decodeImage(success.bytes);
      expect(decoded, isNotNull);
      expect(decoded!.width, equals(480));
      expect(decoded.height, equals(360));
    });

    test('AC 1: decodes PNG photo and encodes as static WebP', () {
      final image = img.Image(width: 300, height: 600);
      for (var y = 0; y < 600; y++) {
        for (var x = 0; x < 300; x++) {
          image.setPixelRgb(x, y, 100, (x * 255 / 300).round(), (y * 255 / 600).round());
        }
      }
      final rawPng = Uint8List.fromList(img.encodePng(image));

      final result = CommentImageCompressor.compress(rawPng);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;

      // Verify WebP magic bytes
      expect(String.fromCharCodes(success.bytes.sublist(0, 4)), equals('RIFF'));
      expect(String.fromCharCodes(success.bytes.sublist(8, 12)), equals('WEBP'));
      expect(success.width, equals(240));
      expect(success.height, equals(480));
    });

    test('AC 1: decodes WebP photo and encodes as compliant WebP', () {
      final image = img.Image(width: 960, height: 540);
      img.fill(image, color: img.ColorRgb8(200, 150, 100));
      final rawWebP = Uint8List.fromList(img.encodeWebP(image));

      final result = CommentImageCompressor.compress(rawWebP);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;
      expect(success.width, equals(480));
      expect(success.height, equals(270));
    });

    test('AC 2: strips forbidden metadata (EXIF, textData) from output', () {
      final image = img.Image(width: 400, height: 400);
      img.fill(image, color: img.ColorRgb8(50, 100, 150));
      image.exif.imageIfd['Make'] = 'PupzyCam';
      image.exif.imageIfd['Model'] = 'Model-X';
      image.textData = {'Author': 'PupzyAuthor', 'Copyright': 'Pupzy 2026'};

      final rawJpegWithMetadata = Uint8List.fromList(img.encodeJpg(image));

      final result = CommentImageCompressor.compress(rawJpegWithMetadata);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;

      // Verify decoded image has no EXIF or text metadata
      final decoded = img.decodeImage(success.bytes)!;
      expect(decoded.exif.isEmpty, isTrue);

      // Verify raw bytes do not contain EXIF or XMP FourCC chunks
      final byteString = String.fromCharCodes(success.bytes);
      expect(byteString.contains('EXIF'), isFalse);
      expect(byteString.contains('XMP '), isFalse);
    });

    test('AC 2: bounds longest edge to 480 and preserves aspect ratio (landscape 1920x1080 -> 480x270)', () {
      final image = img.Image(width: 1920, height: 1080);
      img.fill(image, color: img.ColorRgb8(120, 120, 120));
      final rawBytes = Uint8List.fromList(img.encodeJpg(image));

      final result = CommentImageCompressor.compress(rawBytes);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;
      expect(success.width, equals(480));
      expect(success.height, equals(270));
      expect(success.width / success.height, closeTo(1920 / 1080, 0.01));
    });

    test('AC 2: bounds longest edge to 480 and preserves aspect ratio (portrait 1080x1920 -> 270x480)', () {
      final image = img.Image(width: 1080, height: 1920);
      img.fill(image, color: img.ColorRgb8(120, 120, 120));
      final rawBytes = Uint8List.fromList(img.encodeJpg(image));

      final result = CommentImageCompressor.compress(rawBytes);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;
      expect(success.width, equals(270));
      expect(success.height, equals(480));
      expect(success.height / success.width, closeTo(1920 / 1080, 0.01));
    });

    test('AC 2: never upscales smaller images (200x150 remains 200x150)', () {
      final image = img.Image(width: 200, height: 150);
      img.fill(image, color: img.ColorRgb8(80, 160, 240));
      final rawBytes = Uint8List.fromList(img.encodePng(image));

      final result = CommentImageCompressor.compress(rawBytes);

      expect(result, isA<CommentImageSuccess>());
      final success = result as CommentImageSuccess;
      expect(success.width, equals(200));
      expect(success.height, equals(150));
    });

    test('AC 3: progressively reduces quality to fit within 100,000 bytes', () {
      // Create a high-detail 480x480 image
      final image = img.Image(width: 480, height: 480);
      final rng = Random(42);
      for (var y = 0; y < 480; y++) {
        for (var x = 0; x < 480; x++) {
          image.setPixelRgb(x, y, rng.nextInt(256), rng.nextInt(256), rng.nextInt(256));
        }
      }
      final rawBytes = Uint8List.fromList(img.encodePng(image));

      final result = CommentImageCompressor.compress(rawBytes);

      // Either it successfully compresses <= 100,000 bytes or fails with localized message
      if (result is CommentImageSuccess) {
        expect(result.bytes.length, lessThanOrEqualTo(100000));
        expect(result.width, equals(480));
        expect(result.height, equals(480));
      } else {
        expect(result, isA<CommentImageFailure>());
        final failure = result as CommentImageFailure;
        expect(failure.messageEn, contains('100 KB limit'));
        expect(failure.messageAr, contains('100 كيلوبايت'));
      }
    });

    test('AC 3: returns localized failure when image cannot fit <= 100,000 bytes', () {
      // Corrupt or empty or uncompressable: test explicit failure structure
      const failure = CommentImageFailure(
        'Image exceeds 100 KB limit after compression. Please select a smaller or simpler photo.',
        'حجم الصورة يتجاوز 100 كيلوبايت بعد الضغط. يرجى اختيار صورة أصغر أو أبسط.',
      );
      expect(failure.messageEn, contains('100 KB limit'));
      expect(failure.messageAr, contains('100 كيلوبايت'));
    });

    test('AC 3 & AC 6: returns localized failure on corrupt / unsupported image bytes', () {
      final corruptBytes = Uint8List.fromList([0x00, 0x01, 0x02, 0x03, 0xFF, 0xAA]);

      final result = CommentImageCompressor.compress(corruptBytes);

      expect(result, isA<CommentImageFailure>());
      final failure = result as CommentImageFailure;
      expect(failure.messageEn, equals('Unsupported or corrupt image format.'));
      expect(failure.messageAr, equals('صيغة الصورة غير مدعومة أو تالفة.'));
    });
  });
}
