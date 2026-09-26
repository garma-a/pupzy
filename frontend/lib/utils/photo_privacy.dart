import 'package:flutter/foundation.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';

/// Prepares a picked photo for a post upload: re-encodes it as JPEG with all
/// metadata removed. Phone photos carry EXIF — including the GPS position they
/// were taken at — and post photos are published byte-for-byte, so without
/// this a Mating, Adoption or Product listing could reveal the owner's home
/// even though those posts deliberately show only a city. Which metadata the
/// OS picker keeps varies (iOS keeps it with image_picker's defaults), so the
/// app strips it itself. Rotation is applied first, so dropping the
/// orientation tag never leaves a photo sideways.
///
/// If re-encoding fails the original bytes are uploaded unchanged rather than
/// blocking the post.
Future<(Uint8List bytes, String contentType)> photoForUpload(XFile image) async {
  final original = await image.readAsBytes();
  try {
    final cleaned = await FlutterImageCompress.compressWithList(
      original,
      format: CompressFormat.jpeg,
      quality: 88,
      keepExif: false,
      autoCorrectionAngle: true,
      // The picker already caps photos at 1600 px; don't shrink them further.
      minWidth: 1600,
      minHeight: 1600,
    );
    if (cleaned.isNotEmpty) return (cleaned, 'image/jpeg');
  } catch (e) {
    debugPrint('photoForUpload: could not strip metadata ($e); uploading the original');
  }
  return (original, image.mimeType ?? 'image/jpeg');
}
