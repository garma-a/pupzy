import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/rescue_proof.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

/// One photo chosen for a proof, already read into memory so it can be shown
/// and uploaded without touching the file again.
class ProofPhoto {
  final XFile file;
  final Uint8List bytes;
  final String contentType;
  const ProofPhoto({required this.file, required this.bytes, required this.contentType});
}

typedef ProofPhotoPicker = Future<XFile?> Function(ImageSource source);

/// Uploads every photo and returns their media ids in order. Throws
/// [ProofPhotoUploadException] if any single photo fails — a proof must never
/// be sent with fewer photos than the person chose.
typedef ProofPhotoUploader = Future<List<String>> Function(GraphQLService graphql, List<ProofPhoto> photos);

class ProofPhotoUploadException implements Exception {
  final int photoNumber;
  const ProofPhotoUploadException(this.photoNumber);
}

Future<XFile?> _pickWithImagePicker(ImageSource source) {
  // Downscale + re-encode at pick time so a full-resolution camera photo
  // (10+ MB) is never uploaded — same settings as the post form.
  return ImagePicker().pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 80);
}

String _mimeTypeFor(XFile file) {
  final mime = file.mimeType;
  if (mime != null) return mime;
  switch (file.path.split('.').last.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

Future<List<String>> defaultProofPhotoUploader(GraphQLService graphql, List<ProofPhoto> photos) async {
  final mediaIds = <String>[];
  for (var i = 0; i < photos.length; i++) {
    final photo = photos[i];
    final ticket = await graphql.requestMediaUploadUrl(contentType: photo.contentType, fileSizeBytes: photo.bytes.length);
    if (ticket == null) throw ProofPhotoUploadException(i + 1);
    final response = await http.put(
      Uri.parse(ticket['uploadUrl'] as String),
      headers: {'Content-Type': photo.contentType},
      body: photo.bytes,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) throw ProofPhotoUploadException(i + 1);
    mediaIds.add(ticket['mediaId'] as String);
  }
  return mediaIds;
}

const int kProofMaxPhotos = 4;
const int kProofStoryMinLength = 20;
const int kProofStoryMaxLength = 1000;
const int kProofAreaMinLength = 2;
const int kProofAreaMaxLength = 120;

/// The form a rescuer (RESCUE post) or finder (LOST_PET post) fills in to prove
/// the outcome to the post owner. Pops with the created [RescueProof].
class RescueProofFormScreen extends StatefulWidget {
  final String postId;
  final ProofPostKind kind;

  /// Pre-fills "where" with the post's own area so it is one tap to confirm.
  final String? defaultArea;

  final ProofPhotoPicker? photoPicker;
  final ProofPhotoUploader? photoUploader;

  /// Only for tests: the initial value of the "when" field.
  @visibleForTesting
  final DateTime? initialHappenedAt;

  const RescueProofFormScreen({
    super.key,
    required this.postId,
    required this.kind,
    this.defaultArea,
    this.photoPicker,
    this.photoUploader,
    this.initialHappenedAt,
  });

  @override
  State<RescueProofFormScreen> createState() => _RescueProofFormScreenState();
}

class _RescueProofFormScreenState extends State<RescueProofFormScreen> {
  final List<ProofPhoto> _photos = [];
  late DateTime _happenedAt;
  late final TextEditingController _areaController;
  final _storyController = TextEditingController();
  String? _condition;
  String? _whereabouts;
  bool _consent = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _happenedAt = widget.initialHappenedAt ?? DateTime.now();
    _areaController = TextEditingController(text: widget.defaultArea ?? '');
  }

  @override
  void dispose() {
    _areaController.dispose();
    _storyController.dispose();
    super.dispose();
  }

  // A few minutes of slack so a slightly-fast phone clock can't block a
  // proof submitted "just now".
  bool get _happenedInFuture => _happenedAt.isAfter(DateTime.now().add(const Duration(minutes: 5)));
  int get _storyLength => _storyController.text.trim().length;

  bool get _valid =>
      _photos.isNotEmpty &&
      _photos.length <= kProofMaxPhotos &&
      !_happenedInFuture &&
      _areaController.text.trim().length >= kProofAreaMinLength &&
      _condition != null &&
      _whereabouts != null &&
      _storyLength >= kProofStoryMinLength &&
      _consent;

  Future<void> _addPhoto() async {
    if (_photos.length >= kProofMaxPhotos || _submitting) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppSpacing.sm),
            ListTile(
              key: const Key('proofPickCamera'),
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(t(ctx, 'Take a photo', 'التقاط صورة')),
              onTap: () => Navigator.of(ctx).pop(ImageSource.camera),
            ),
            ListTile(
              key: const Key('proofPickGallery'),
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(t(ctx, 'Choose from gallery', 'اختيار من المعرض')),
              onTap: () => Navigator.of(ctx).pop(ImageSource.gallery),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    final picked = await (widget.photoPicker ?? _pickWithImagePicker)(source);
    if (picked == null || !mounted) return;
    final bytes = await picked.readAsBytes();
    if (!mounted) return;
    setState(() => _photos.add(ProofPhoto(file: picked, bytes: bytes, contentType: _mimeTypeFor(picked))));
  }

  Future<void> _pickWhen() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _happenedAt.isAfter(now) ? now : _happenedAt,
      firstDate: now.subtract(const Duration(days: 90)),
      lastDate: now,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_happenedAt));
    if (time == null || !mounted) return;
    setState(() => _happenedAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _submit() async {
    if (!_valid || _submitting) return;
    final graphql = context.read<GraphQLService>();
    final sentCopy = t(context, 'Sent to the owner for review', 'تم الإرسال إلى المالك للمراجعة');
    final failedCopy = t(context, 'Could not send your proof. Try again.', 'تعذر إرسال إثباتك. حاول مرة أخرى.');
    setState(() => _submitting = true);

    final List<String> mediaIds;
    try {
      mediaIds = await (widget.photoUploader ?? defaultProofPhotoUploader)(graphql, List.unmodifiable(_photos));
    } on ProofPhotoUploadException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      Fluttertoast.showToast(
        msg: t(
          context,
          'Photo ${e.photoNumber} failed to upload. Check your connection and try again.',
          'فشل رفع الصورة ${e.photoNumber}. تحقق من اتصالك وحاول مرة أخرى.',
        ),
      );
      return;
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      Fluttertoast.showToast(msg: t(context, 'Could not upload your photos. Try again.', 'تعذر رفع صورك. حاول مرة أخرى.'));
      return;
    }
    if (!mounted) return;

    final (proof, _, message) = await graphql.submitRescueProof(
      postId: widget.postId,
      mediaIds: mediaIds,
      happenedAt: _happenedAt,
      areaName: _areaController.text.trim(),
      condition: _condition!,
      whereabouts: _whereabouts!,
      story: _storyController.text.trim(),
    );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (proof == null) {
      Fluttertoast.showToast(msg: message ?? failedCopy);
      return;
    }
    Navigator.of(context).pop(proof);
    Fluttertoast.showToast(msg: sentCopy);
  }

  Widget _sectionLabel(String text, {bool required = true}) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.lg, bottom: AppSpacing.sm),
      child: Text(required ? '$text *' : text, style: Theme.of(context).textTheme.labelLarge),
    );
  }

  Widget _choiceChips(String keyPrefix, List<ProofChoice> choices, String? selected, ValueChanged<String> onSelected) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: choices
          .map(
            (c) => ChoiceChip(
              key: Key('$keyPrefix${c.value}'),
              label: Text(t(context, c.en, c.ar)),
              selected: selected == c.value,
              onSelected: _submitting ? null : (_) => onSelected(c.value),
            ),
          )
          .toList(),
    );
  }

  Widget _photoTile(int index) {
    final photo = _photos[index];
    return Stack(
      clipBehavior: Clip.none,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.image),
          child: Image.memory(photo.bytes, key: Key('proofPhoto_$index'), width: 88, height: 88, fit: BoxFit.cover),
        ),
        PositionedDirectional(
          top: -6,
          end: -6,
          child: GestureDetector(
            key: Key('proofRemovePhoto_$index'),
            onTap: _submitting ? null : () => setState(() => _photos.removeAt(index)),
            child: const CircleAvatar(radius: 11, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 13, color: Colors.white)),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    // Own pushed route — see account_suspended_screen.dart's comment for why
    // this direct dependency is needed for immediate language updates.
    context.watch<LangProvider>();
    final kind = widget.kind;
    final loc = MaterialLocalizations.of(context);
    final whenLabel = '${loc.formatMediumDate(_happenedAt)} · ${loc.formatTimeOfDay(TimeOfDay.fromDateTime(_happenedAt))}';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, kind.titleEn, kind.titleAr), style: Theme.of(context).textTheme.headlineSmall),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t(context, kind.introEn, kind.introAr), style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary)),

              _sectionLabel('${t(context, kind.photosEn, kind.photosAr)} (1–$kProofMaxPhotos)'),
              Wrap(
                spacing: AppSpacing.md,
                runSpacing: AppSpacing.md,
                children: [
                  for (var i = 0; i < _photos.length; i++) _photoTile(i),
                  if (_photos.length < kProofMaxPhotos)
                    GestureDetector(
                      key: const Key('proofAddPhoto'),
                      onTap: _addPhoto,
                      child: Container(
                        width: 88,
                        height: 88,
                        decoration: BoxDecoration(
                          color: AppColors.surfaceWarm,
                          borderRadius: BorderRadius.circular(AppRadius.image),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const Icon(Icons.add_a_photo_outlined, color: AppColors.textSecondary),
                      ),
                    ),
                ],
              ),

              _sectionLabel(t(context, kind.whenEn, kind.whenAr)),
              OutlinedButton.icon(
                key: const Key('proofWhenButton'),
                onPressed: _submitting ? null : _pickWhen,
                icon: const Icon(Icons.event_outlined, size: 18),
                label: Text(whenLabel),
              ),
              if (_happenedInFuture)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text(
                    t(context, "That time is in the future.", 'هذا الوقت في المستقبل.'),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.critical),
                  ),
                ),

              _sectionLabel(t(context, kind.whereEn, kind.whereAr)),
              TextField(
                key: const Key('proofAreaField'),
                controller: _areaController,
                maxLength: kProofAreaMaxLength,
                enabled: !_submitting,
                onChanged: (_) => setState(() {}),
                decoration: _fieldDecoration(t(context, 'Neighbourhood or street', 'الحي أو الشارع')),
              ),

              _sectionLabel(t(context, 'How is the animal now?', 'كيف حال الحيوان الآن؟')),
              _choiceChips('proofCondition_', proofConditions, _condition, (v) => setState(() => _condition = v)),

              _sectionLabel(t(context, 'Where is the animal now?', 'أين الحيوان الآن؟')),
              _choiceChips('proofWhereabouts_', proofWhereabouts, _whereabouts, (v) => setState(() => _whereabouts = v)),

              _sectionLabel(t(context, 'Your story', 'قصتك')),
              TextField(
                key: const Key('proofStoryField'),
                controller: _storyController,
                maxLines: 5,
                maxLength: kProofStoryMaxLength,
                enabled: !_submitting,
                onChanged: (_) => setState(() {}),
                decoration: _fieldDecoration(t(context, kind.storyHintEn, kind.storyHintAr)),
              ),
              if (_storyLength > 0 && _storyLength < kProofStoryMinLength)
                Text(
                  t(
                    context,
                    'Write at least $kProofStoryMinLength characters so the owner can trust it.',
                    'اكتب $kProofStoryMinLength حرفًا على الأقل ليطمئن المالك.',
                  ),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textSecondary),
                ),

              const SizedBox(height: AppSpacing.md),
              CheckboxListTile(
                key: const Key('proofConsentCheckbox'),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _consent,
                onChanged: _submitting ? null : (v) => setState(() => _consent = v ?? false),
                title: Text(
                  t(
                    context,
                    'If the owner confirms my proof, share my WhatsApp number with them so we can coordinate.',
                    'إذا أكّد المالك إثباتي، شارك رقم واتساب الخاص بي معه للتنسيق.',
                  ),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),

              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  key: const Key('proofSubmitButton'),
                  onPressed: _valid && !_submitting ? _submit : null,
                  child: _submitting
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                      : Text(t(context, 'Send proof to the owner', 'إرسال الإثبات إلى المالك')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: AppColors.surfaceWarm,
      contentPadding: const EdgeInsets.all(16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.card), borderSide: BorderSide.none),
    );
  }
}
