import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:image_picker/image_picker.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// Photos per post; the backend accepts at most four.
const maxPostPhotos = 4;

// Downscale and re-encode at pick time so a full-resolution camera photo
// (10+ MB) is never uploaded: uploads stay fast and under the backend's
// 5 MB-per-image limit.
const double _maxSide = 1600;
const int _quality = 80;

/// [current] with [picked] appended: photos already in the post are
/// skipped, and nothing past [maxPostPhotos] is kept. Also returns how many
/// new photos didn't fit.
({List<XFile> photos, int overLimit}) addPostPhotos(List<XFile> current, List<XFile> picked) {
  final photos = [...current];
  final seen = {for (final photo in current) photo.path};
  var overLimit = 0;
  for (final photo in picked) {
    if (!seen.add(photo.path)) continue;
    if (photos.length >= maxPostPhotos) {
      overLimit++;
    } else {
      photos.add(photo);
    }
  }
  return (photos: photos, overLimit: overLimit);
}

/// Photos the picker returned after Android closed the app while the
/// camera or gallery was open (low-memory phones do this). Call when a post
/// form opens. Empty on other platforms and when nothing was lost.
Future<List<XFile>> recoverLostPostPhotos() async {
  if (kIsWeb || !Platform.isAndroid) return const [];
  try {
    final response = await ImagePicker().retrieveLostData();
    if (response.isEmpty) return const [];
    return response.files ?? (response.file == null ? const [] : [response.file!]);
  } catch (_) {
    return const [];
  }
}

/// The photo box of a post form: add photos from the camera or the
/// gallery (several at once), remove them, reorder them by long-press and
/// drag, and choose the cover. The first photo is the cover: it is uploaded
/// first and shown on feed cards.
class PostPhotoPicker extends StatelessWidget {
  const PostPhotoPicker({super.key, required this.photos, required this.onChanged, required this.title, required this.subtitle});

  final List<XFile> photos;
  final ValueChanged<List<XFile>> onChanged;

  /// Shown in the empty box, e.g. "Add photos of your pet".
  final String title;
  final String subtitle;

  int get _remaining => maxPostPhotos - photos.length;

  void _toast(String message) => Fluttertoast.showToast(msg: message);

  Future<void> _add(BuildContext context) async {
    if (_remaining <= 0) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.background,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined, color: AppColors.primary),
                title: Text(t(context, 'Take a photo', 'التقاط صورة')),
                onTap: () => Navigator.of(sheet).pop(ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined, color: AppColors.primary),
                title: Text(t(context, 'Choose from gallery', 'اختيار من المعرض')),
                subtitle: Text(
                  _remaining == 1
                      ? t(context, '1 more photo', 'صورة واحدة أخرى')
                      : t(context, 'Up to $_remaining photos at once', 'حتى $_remaining صور مرة واحدة'),
                ),
                onTap: () => Navigator.of(sheet).pop(ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null || !context.mounted) return;

    final List<XFile> picked;
    try {
      final picker = ImagePicker();
      if (source == ImageSource.camera) {
        final photo = await picker.pickImage(
          source: ImageSource.camera,
          preferredCameraDevice: CameraDevice.rear,
          maxWidth: _maxSide,
          maxHeight: _maxSide,
          imageQuality: _quality,
        );
        picked = photo == null ? const [] : [photo];
      } else {
        // Some platforms ignore the limit; addPostPhotos enforces it anyway.
        picked = await picker.pickMultiImage(maxWidth: _maxSide, maxHeight: _maxSide, imageQuality: _quality, limit: _remaining);
      }
    } on PlatformException catch (e) {
      if (!context.mounted) return;
      final camera = source == ImageSource.camera;
      if (e.code == 'camera_access_denied' || e.code == 'photo_access_denied') {
        _toast(
          camera
              ? t(context, "Allow camera access for Pupzy in your phone's settings", 'اسمح لبابزي باستخدام الكاميرا من إعدادات هاتفك')
              : t(context, "Allow photo access for Pupzy in your phone's settings", 'اسمح لبابزي بالوصول إلى الصور من إعدادات هاتفك'),
        );
      } else {
        _toast(
          camera ? t(context, "Couldn't open the camera", 'تعذر فتح الكاميرا') : t(context, "Couldn't open your photos", 'تعذر فتح الصور'),
        );
      }
      return;
    }
    if (!context.mounted || picked.isEmpty) return;

    final result = addPostPhotos(photos, picked);
    if (result.overLimit > 0) {
      _toast(
        t(
          context,
          'A post can have $maxPostPhotos photos: the first ones were added',
          'المنشور يقبل $maxPostPhotos صور: تمت إضافة الأولى منها',
        ),
      );
    }
    if (result.photos.length != photos.length) onChanged(result.photos);
  }

  void _remove(int index) => onChanged([...photos]..removeAt(index));

  void _makeCover(int index) {
    final reordered = [...photos];
    reordered.insert(0, reordered.removeAt(index));
    onChanged(reordered);
  }

  void _reorder(int oldIndex, int newIndex) {
    if (newIndex > oldIndex) newIndex -= 1;
    if (newIndex == oldIndex) return;
    final reordered = [...photos];
    reordered.insert(newIndex, reordered.removeAt(oldIndex));
    onChanged(reordered);
  }

  Future<void> _photoActions(BuildContext context, int index) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.background,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (index > 0)
                ListTile(
                  leading: const Icon(Icons.star_outline, color: AppColors.primary),
                  title: Text(t(context, 'Set as cover', 'تعيين كغلاف')),
                  onTap: () {
                    Navigator.of(sheet).pop();
                    _makeCover(index);
                  },
                ),
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.critical),
                title: Text(t(context, 'Remove photo', 'إزالة الصورة'), style: const TextStyle(color: AppColors.critical)),
                onTap: () {
                  Navigator.of(sheet).pop();
                  _remove(index);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final box = BoxDecoration(
      color: AppColors.surfaceWarm,
      borderRadius: BorderRadius.circular(AppRadius.card),
      border: Border.all(color: AppColors.border),
    );

    if (photos.isEmpty) {
      return InkWell(
        key: const Key('addPostPhotos'),
        onTap: () => _add(context),
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
          decoration: box,
          child: Column(
            children: [
              const Icon(Icons.add_a_photo_outlined, color: AppColors.textMuted, size: 28),
              const SizedBox(height: AppSpacing.sm),
              Text(
                title,
                style: textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 2),
              Text(subtitle, style: textTheme.bodySmall, textAlign: TextAlign.center),
              const SizedBox(height: 2),
              Text(t(context, 'Camera or gallery', 'الكاميرا أو المعرض'), style: textTheme.bodySmall),
            ],
          ),
        ),
      );
    }

    final thumbSize = 90.0;
    final cacheWidth = (thumbSize * MediaQuery.devicePixelRatioOf(context)).round();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: box,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: thumbSize + 8,
            child: ReorderableListView.builder(
              scrollDirection: Axis.horizontal,
              buildDefaultDragHandles: false,
              itemCount: photos.length,
              onReorder: _reorder,
              footer: _remaining > 0
                  ? Padding(
                      padding: const EdgeInsets.all(4),
                      child: Semantics(
                        button: true,
                        label: t(context, 'Add photos', 'إضافة صور'),
                        child: InkWell(
                          key: const Key('addMorePostPhotos'),
                          onTap: () => _add(context),
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            width: thumbSize,
                            height: thumbSize,
                            decoration: BoxDecoration(
                              border: Border.all(color: AppColors.border),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(Icons.add_a_photo_outlined, color: AppColors.textMuted),
                          ),
                        ),
                      ),
                    )
                  : null,
              itemBuilder: (context, index) {
                final photo = photos[index];
                return ReorderableDelayedDragStartListener(
                  key: ValueKey(photo.path),
                  index: index,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: _Thumbnail(
                      photo: photo,
                      size: thumbSize,
                      cacheWidth: cacheWidth,
                      isCover: index == 0,
                      position: index + 1,
                      onTap: () => _photoActions(context, index),
                      onRemove: () => _remove(index),
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 4),
          Text(
            photos.length > 1
                ? t(
                    context,
                    'Hold and drag to reorder · the first photo is the cover',
                    'اضغط مطولًا واسحب لإعادة الترتيب · الصورة الأولى هي الغلاف',
                  )
                : t(context, 'The first photo is the cover', 'الصورة الأولى هي الغلاف'),
            style: textTheme.bodySmall?.copyWith(color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({
    required this.photo,
    required this.size,
    required this.cacheWidth,
    required this.isCover,
    required this.position,
    required this.onTap,
    required this.onRemove,
  });

  final XFile photo;
  final double size;
  final int cacheWidth;
  final bool isCover;
  final int position;
  final VoidCallback onTap;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: isCover ? t(context, 'Photo $position, cover', 'الصورة $position، الغلاف') : t(context, 'Photo $position', 'الصورة $position'),
      child: GestureDetector(
        onTap: onTap,
        child: SizedBox(
          width: size,
          height: size,
          child: Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                // Decode at thumbnail size, not the photo's 1600 px.
                child: Image.file(File(photo.path), width: size, height: size, fit: BoxFit.cover, cacheWidth: cacheWidth),
              ),
              if (isCover)
                PositionedDirectional(
                  start: 0,
                  end: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    decoration: const BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.vertical(bottom: Radius.circular(12)),
                    ),
                    // The photo's label already says it is the cover.
                    child: ExcludeSemantics(
                      child: Text(
                        t(context, 'Cover', 'الغلاف'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ),
              PositionedDirectional(
                top: 4,
                end: 4,
                child: Semantics(
                  button: true,
                  label: t(context, 'Remove photo $position', 'إزالة الصورة $position'),
                  child: InkWell(
                    onTap: onRemove,
                    customBorder: const CircleBorder(),
                    child: Container(
                      width: 24,
                      height: 24,
                      decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                      child: const Icon(Icons.close, color: Colors.white, size: 14),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
