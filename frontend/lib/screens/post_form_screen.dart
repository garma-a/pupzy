import 'dart:io';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/post.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

/// A fixed-choice option: (canonical value sent to the backend, English label, Arabic label).
/// The canonical value is what state/logic keys off of — never the translated label.
typedef Choice = (String value, String en, String ar);

class PostFormScreen extends StatefulWidget {
  final PostType type;
  final String? initialCategory;

  const PostFormScreen({super.key, required this.type, this.initialCategory});

  @override
  State<PostFormScreen> createState() => _PostFormScreenState();
}

class _PostFormScreenState extends State<PostFormScreen> {
  final TextEditingController _captionController = TextEditingController();
  final TextEditingController _conditionController = TextEditingController();
  final TextEditingController _neighborhoodController = TextEditingController();
  final TextEditingController _landmarkController = TextEditingController();
  final TextEditingController _productTitleController = TextEditingController();
  final TextEditingController _priceController = TextEditingController();
  final List<XFile> _images = [];
  String? _selectedCategory;

  String? _species;
  String? _urgency;
  String? _role;
  String? _condition;
  bool _isFree = false;
  bool _openToOffers = false;
  bool _submitting = false;

  static const List<Choice> _speciesOptions = [
    ('DOG', 'Dog', 'كلب'),
    ('CAT', 'Cat', 'قطة'),
    ('OTHER', 'Other', 'أخرى'),
  ];

  static const List<Choice> _urgencyOptions = [
    ('CRITICAL', 'Critical — needs help now', 'حرجة — تحتاج مساعدة فورية'),
    ('URGENT', 'Urgent — needs help soon', 'عاجلة — تحتاج مساعدة قريبًا'),
    ('MODERATE', 'Moderate — stable but needs care', 'متوسطة — مستقرة لكن تحتاج رعاية'),
  ];

  static const List<Choice> _roleOptions = [
    ('REPORTING', "Reporting — I saw it but can't stay", 'مُبلّغ — رأيت الحيوان لكن لا أستطيع البقاء'),
    ('ON_SITE', "On-site — I'm with the animal", 'في الموقع — أنا مع الحيوان'),
    ('CAN_TRANSPORT', 'Can transport — I have a vehicle', 'يمكنني النقل — لدي وسيلة نقل'),
  ];

  static const List<Choice> _conditionOptions = [
    ('NEW', 'New', 'جديد'),
    ('LIKE_NEW', 'Like New', 'شبه جديد'),
    ('USED', 'Used', 'مستعمل'),
  ];

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialCategory;
  }

  List<Choice> get _categories {
    switch (widget.type) {
      case PostType.adoption:
        return const [
          ('DOG', 'Dog', 'كلب'),
          ('PUPPY', 'Puppy', 'جرو'),
          ('SENIOR', 'Senior', 'كبير السن'),
          ('SPECIAL_NEEDS', 'Special Needs', 'احتياجات خاصة'),
        ];
      case PostType.rescue:
        return const [
          ('URGENT', 'Urgent', 'عاجل'),
          ('FOUND', 'Found', 'تم العثور عليه'),
          ('LOST', 'Lost', 'مفقود'),
          ('NEEDS_FOSTER', 'Needs Foster', 'يحتاج حاضنة'),
        ];
      case PostType.product:
        return const [
          ('CARE', 'Care', 'رعاية'),
          ('FOOD', 'Food', 'طعام'),
          ('TRANSPORT', 'Transport', 'نقل'),
          ('ACCESSORIES', 'Accessories', 'إكسسوارات'),
          ('GROOMING', 'Grooming', 'تجميل'),
          ('MEDICAL_SUPPLIES', 'Medical Supplies', 'مستلزمات طبية'),
          ('OTHER', 'Other', 'أخرى'),
        ];
      case PostType.general:
        return const [
          ('FUNNY', 'Funny', 'مضحك'),
          ('CUTE', 'Cute', 'لطيف'),
          ('TRAINING', 'Training', 'تدريب'),
          ('STORY', 'Story', 'قصة'),
        ];
    }
  }

  String get _title {
    switch (widget.type) {
      case PostType.adoption:
        return t(context, 'New Adoption Listing', 'إعلان تبني جديد');
      case PostType.rescue:
        return t(context, 'New Rescue Alert', 'تنبيه إنقاذ جديد');
      case PostType.product:
        return t(context, 'New Product', 'منتج جديد');
      case PostType.general:
        return t(context, 'New Post', 'منشور جديد');
    }
  }

  String _labelFor(List<Choice> options, String value) {
    final match = options.firstWhere((o) => o.$1 == value);
    return t(context, match.$2, match.$3);
  }

  Future<void> _pickImage() async {
    if (_images.length >= 5) return;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked != null) setState(() => _images.add(picked));
  }

  void _submit() {
    final caption = _captionController.text.trim();
    if (caption.isEmpty) {
      Fluttertoast.showToast(msg: t(context, 'Please add a caption', 'يرجى إضافة وصف'));
      return;
    }
    MockData.posts.insert(
      0,
      Post(
        id: 'p${DateTime.now().millisecondsSinceEpoch}',
        username: 'pup_lover_22',
        avatarUrl: 'https://i.pravatar.cc/150?img=12',
        imageUrls: ['https://placedog.net/600/400?id=${DateTime.now().millisecondsSinceEpoch % 50}'],
        caption: caption,
        timestamp: DateTime.now(),
        type: widget.type,
      ),
    );
    Fluttertoast.showToast(msg: t(context, 'Post submitted!', 'تم نشر المنشور!'));
    Navigator.of(context).pop();
  }

  bool get _rescueFormValid {
    return _images.isNotEmpty &&
        _species != null &&
        _conditionController.text.trim().isNotEmpty &&
        _urgency != null &&
        _neighborhoodController.text.trim().isNotEmpty &&
        _role != null;
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

  Future<Position?> _getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      Fluttertoast.showToast(
        msg: t(context, 'Please enable location services', 'يرجى تفعيل خدمات الموقع'),
        backgroundColor: AppColors.critical,
        textColor: Colors.white,
      );
      return null;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        Fluttertoast.showToast(
          msg: t(context, 'Location permission denied', 'تم رفض إذن الموقع'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
        return null;
      }
    }

    var pos = await Geolocator.getLastKnownPosition();
    pos ??= await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.low, timeLimit: Duration(seconds: 30)),
    );
    return pos;
  }

  bool get _productFormValid {
    return _images.isNotEmpty &&
        _productTitleController.text.trim().isNotEmpty &&
        _captionController.text.trim().isNotEmpty &&
        _selectedCategory != null &&
        _condition != null &&
        _neighborhoodController.text.trim().isNotEmpty &&
        (_isFree || double.tryParse(_priceController.text.trim()) != null);
  }

  Future<void> _submitProduct() async {
    if (!_productFormValid || _submitting) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final bytes = await image.readAsBytes();
        final contentType = _mimeTypeFor(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final response = await http.put(
          Uri.parse(uploadInfo['uploadUrl'] as String),
          headers: {'Content-Type': contentType},
          body: bytes,
        );
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        }
      }

      final neighborhood = _neighborhoodController.text.trim();
      final landmark = _landmarkController.text.trim();
      final areaName = landmark.isEmpty ? neighborhood : '$neighborhood — near $landmark';

      final result = await graphql.createProductPost(
        title: _productTitleController.text.trim(),
        description: _captionController.text.trim(),
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: areaName.isEmpty ? null : areaName,
        category: _selectedCategory!,
        condition: _condition!,
        priceAmount: _isFree ? null : double.tryParse(_priceController.text.trim()),
        isFree: _isFree,
        openToOffers: _openToOffers,
        mediaIds: mediaIds,
      );

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Listing posted!', 'تم نشر الإعلان!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: t(context, 'Failed to post listing', 'فشل نشر الإعلان'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitRescue() async {
    if (!_rescueFormValid || _submitting) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final bytes = await image.readAsBytes();
        final contentType = _mimeTypeFor(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final response = await http.put(
          Uri.parse(uploadInfo['uploadUrl'] as String),
          headers: {'Content-Type': contentType},
          body: bytes,
        );
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        }
      }

      final neighborhood = _neighborhoodController.text.trim();
      final landmark = _landmarkController.text.trim();
      final areaName = landmark.isEmpty ? neighborhood : '$neighborhood — near $landmark';
      final condition = _conditionController.text.trim();
      final urgencyLabel = _labelFor(_urgencyOptions, _urgency!);
      final speciesLabel = _labelFor(_speciesOptions, _species!);

      final result = await graphql.createRescuePost(
        title: '$urgencyLabel ${t(context, 'rescue', 'إنقاذ')}: $speciesLabel',
        description: condition,
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: areaName.isEmpty ? null : areaName,
        urgency: _urgency!,
        species: _species!,
        conditionSummary: condition,
        reporterRole: _role!,
        mediaIds: mediaIds,
      );

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Rescue alert posted!', 'تم نشر تنبيه الإنقاذ!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: t(context, 'Failed to post rescue alert', 'فشل نشر تنبيه الإنقاذ'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _captionController.dispose();
    _conditionController.dispose();
    _neighborhoodController.dispose();
    _landmarkController.dispose();
    _productTitleController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.type == PostType.rescue) {
      return _buildRescueForm(context);
    }
    if (widget.type == PostType.product) {
      return _buildProductForm(context);
    }
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          Text(t(context, 'Photos', 'الصور'), style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          SizedBox(
            height: 90,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                ..._images.map(
                  (img) => Padding(
                    padding: const EdgeInsets.only(right: AppSpacing.sm),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.file(
                        File(img.path),
                        width: 90,
                        height: 90,
                        fit: BoxFit.cover,
                        errorBuilder: (ctx, err, st) => Container(
                          width: 90,
                          height: 90,
                          color: AppColors.border,
                          child: const Icon(Icons.image),
                        ),
                      ),
                    ),
                  ),
                ),
                if (_images.length < 5)
                  InkWell(
                    onTap: _pickImage,
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      width: 90,
                      height: 90,
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.add_a_photo_outlined, color: AppColors.textMuted),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(t(context, 'Caption', 'الوصف'), style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _captionController,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: t(context, 'Tell the community about it...', 'أخبر المجتمع عن الأمر...'),
              filled: true,
              fillColor: AppColors.background,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.card),
                borderSide: const BorderSide(color: AppColors.border),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(t(context, 'Category', 'الفئة'), style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            children: _categories.map((c) {
              final selected = _selectedCategory == c.$1;
              return ChoiceChip(
                label: Text(t(context, c.$2, c.$3)),
                selected: selected,
                selectedColor: AppColors.primary.withValues(alpha: 0.15),
                onSelected: (_) => setState(() => _selectedCategory = c.$1),
              );
            }).toList(),
          ),
          const SizedBox(height: AppSpacing.xxl),
          ElevatedButton(
            onPressed: _submit,
            child: SizedBox(width: double.infinity, child: Text(t(context, 'Submit', 'نشر'), textAlign: TextAlign.center)),
          ),
        ],
      ),
    );
  }

  Widget _buildRescueForm(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
              child: Row(
                children: [
                  _BackCircle(onTap: () => Navigator.of(context).pop()),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t(context, 'Post a Rescue Alert', 'نشر تنبيه إنقاذ'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(t(context, 'Help an animal in distress', 'ساعد حيوانًا في محنة'), style: Theme.of(context).textTheme.bodyMedium),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                children: [
                  _SectionLabel(t(context, 'ANIMAL DETAILS', 'تفاصيل الحيوان')),
                  const SizedBox(height: AppSpacing.sm),
                  InkWell(
                    onTap: _pickImage,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceWarm,
                        borderRadius: BorderRadius.circular(AppRadius.card),
                        border: Border.all(color: AppColors.border, style: BorderStyle.solid),
                      ),
                      child: Column(
                        children: [
                          if (_images.isEmpty) ...[
                            const Icon(Icons.image_outlined, color: AppColors.textMuted, size: 28),
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              t(context, 'Add photos of the animal', 'أضف صورًا للحيوان'),
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text(t(context, 'Up to 5 photos', 'حتى 5 صور'), style: Theme.of(context).textTheme.bodySmall),
                          ] else
                            SizedBox(
                              height: 90,
                              child: ListView(
                                scrollDirection: Axis.horizontal,
                                children: [
                                  ..._images.map(
                                    (img) => Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(12),
                                        child: Image.file(File(img.path), width: 90, height: 90, fit: BoxFit.cover),
                                      ),
                                    ),
                                  ),
                                  if (_images.length < 5)
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                                      child: Container(
                                        width: 90,
                                        height: 90,
                                        decoration: BoxDecoration(
                                          border: Border.all(color: AppColors.border),
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                        child: const Icon(Icons.add_a_photo_outlined, color: AppColors.textMuted),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Species', 'النوع'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _speciesOptions.map((s) {
                      return _PillChoice(
                        label: t(context, s.$2, s.$3),
                        selected: _species == s.$1,
                        onTap: () => setState(() => _species = s.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Condition description', 'وصف الحالة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _conditionController,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: t(context, "Describe the animal's visible condition...", 'صف الحالة الظاهرة للحيوان...'),
                      hintStyle: TextStyle(color: AppColors.textMuted, fontSize: 14),
                      filled: true,
                      fillColor: AppColors.surfaceWarm,
                      contentPadding: const EdgeInsets.all(16),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.card),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Urgency level', 'مستوى الخطورة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      _UrgencyChoice(
                        label: t(context, _urgencyOptions[0].$2, _urgencyOptions[0].$3),
                        selected: _urgency == 'CRITICAL',
                        color: AppColors.critical,
                        onTap: () => setState(() => _urgency = 'CRITICAL'),
                      ),
                      _UrgencyChoice(
                        label: t(context, _urgencyOptions[1].$2, _urgencyOptions[1].$3),
                        selected: _urgency == 'URGENT',
                        color: AppColors.primary,
                        onTap: () => setState(() => _urgency = 'URGENT'),
                      ),
                      _UrgencyChoice(
                        label: t(context, _urgencyOptions[2].$2, _urgencyOptions[2].$3),
                        selected: _urgency == 'MODERATE',
                        color: AppColors.textSecondary,
                        onTap: () => setState(() => _urgency = 'MODERATE'),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'LOCATION', 'الموقع')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Neighborhood or area', 'الحي أو المنطقة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _neighborhoodController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. Maadi area', 'مثال: منطقة المعادي')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Nearby landmark', 'أقرب معلم'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _landmarkController,
                    decoration: _fieldDecoration(t(context, 'e.g. near Al-Razi pharmacy', 'مثال: بجوار صيدلية الرازي')),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceWarm,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.schedule, size: 16, color: AppColors.textMuted),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            t(context, 'Exact address will never be shown publicly', 'العنوان الدقيق لن يُعرض للعامة أبدًا'),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'YOUR ROLE', 'دورك')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'I am', 'أنا'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Column(
                    children: _roleOptions.map((r) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: _RoleChoice(
                          label: t(context, r.$2, r.$3),
                          selected: _role == r.$1,
                          onTap: () => setState(() => _role = r.$1),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Center(
                    child: Text(
                      t(context, 'Complete all required fields to post', 'أكمل جميع الحقول المطلوبة للنشر'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton(
                      onPressed: (_rescueFormValid && !_submitting) ? _submitRescue : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.critical,
                        disabledBackgroundColor: AppColors.critical.withValues(alpha: 0.35),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            )
                          : Text(t(context, 'Post Rescue Alert', 'نشر تنبيه الإنقاذ')),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProductForm(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
              child: Row(
                children: [
                  _BackCircle(onTap: () => Navigator.of(context).pop()),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t(context, 'List a Product', 'إضافة منتج'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(t(context, 'Buyers contact you directly', 'يتواصل معك المشترون مباشرة'), style: Theme.of(context).textTheme.bodyMedium),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                children: [
                  _SectionLabel(t(context, 'LISTING DETAILS', 'تفاصيل الإعلان')),
                  const SizedBox(height: AppSpacing.sm),
                  InkWell(
                    onTap: _pickImage,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceWarm,
                        borderRadius: BorderRadius.circular(AppRadius.card),
                        border: Border.all(color: AppColors.border, style: BorderStyle.solid),
                      ),
                      child: Column(
                        children: [
                          if (_images.isEmpty) ...[
                            const Icon(Icons.image_outlined, color: AppColors.textMuted, size: 28),
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              t(context, 'Add photos of the item', 'أضف صورًا للمنتج'),
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text(t(context, 'Up to 5 photos', 'حتى 5 صور'), style: Theme.of(context).textTheme.bodySmall),
                          ] else
                            SizedBox(
                              height: 90,
                              child: ListView(
                                scrollDirection: Axis.horizontal,
                                children: [
                                  ..._images.map(
                                    (img) => Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(12),
                                        child: Image.file(File(img.path), width: 90, height: 90, fit: BoxFit.cover),
                                      ),
                                    ),
                                  ),
                                  if (_images.length < 5)
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                                      child: Container(
                                        width: 90,
                                        height: 90,
                                        decoration: BoxDecoration(
                                          border: Border.all(color: AppColors.border),
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                        child: const Icon(Icons.add_a_photo_outlined, color: AppColors.textMuted),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Title', 'العنوان'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _productTitleController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. Field carrier, barely used', 'مثال: حقيبة نقل، شبه جديدة')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Description', 'الوصف'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _captionController,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(
                      t(context, 'Describe the item, condition, and any details buyers should know...', 'صف المنتج وحالته وأي تفاصيل يجب أن يعرفها المشترون...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Category', 'الفئة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _categories.map((c) {
                      return _PillChoice(
                        label: t(context, c.$2, c.$3),
                        selected: _selectedCategory == c.$1,
                        onTap: () => setState(() => _selectedCategory = c.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Condition', 'الحالة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _conditionOptions.map((c) {
                      return _PillChoice(
                        label: t(context, c.$2, c.$3),
                        selected: _condition == c.$1,
                        onTap: () => setState(() => _condition = c.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'PRICE', 'السعر')),
                  const SizedBox(height: AppSpacing.md),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'List as free / giveaway', 'إعلان مجاني / تبرع')),
                    value: _isFree,
                    onChanged: (v) => setState(() => _isFree = v),
                  ),
                  if (!_isFree) ...[
                    const SizedBox(height: AppSpacing.sm),
                    TextField(
                      controller: _priceController,
                      keyboardType: TextInputType.number,
                      onChanged: (_) => setState(() {}),
                      decoration: _fieldDecoration(t(context, 'Price in EGP', 'السعر بالجنيه المصري')),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.sm),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Open to offers', 'قابل للتفاوض')),
                    value: _openToOffers,
                    onChanged: (v) => setState(() => _openToOffers = v),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'LOCATION', 'الموقع')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Neighborhood or area', 'الحي أو المنطقة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _neighborhoodController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. Maadi area', 'مثال: منطقة المعادي')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Nearby landmark', 'أقرب معلم'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _landmarkController,
                    decoration: _fieldDecoration(t(context, 'e.g. near Al-Razi pharmacy', 'مثال: بجوار صيدلية الرازي')),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Center(
                    child: Text(
                      t(context, 'Complete all required fields to post', 'أكمل جميع الحقول المطلوبة للنشر'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton(
                      onPressed: (_productFormValid && !_submitting) ? _submitProduct : null,
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            )
                          : Text(t(context, 'Post Listing', 'نشر الإعلان')),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: AppColors.textMuted, fontSize: 14),
      filled: true,
      fillColor: AppColors.surfaceWarm,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
        borderSide: BorderSide.none,
      ),
    );
  }
}

class _BackCircle extends StatelessWidget {
  final VoidCallback onTap;
  const _BackCircle({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
        child: const Icon(Icons.chevron_left, color: AppColors.textPrimary),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.pets, size: 14, color: AppColors.primary),
        const SizedBox(width: 6),
        Text(
          text,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5),
        ),
      ],
    );
  }
}

class _PillChoice extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _PillChoice({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary.withValues(alpha: 0.15) : AppColors.surfaceWarm,
          borderRadius: BorderRadius.circular(AppRadius.chip),
          border: Border.all(color: selected ? AppColors.primary : Colors.transparent),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? AppColors.primary : AppColors.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}

class _UrgencyChoice extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _UrgencyChoice({required this.label, required this.selected, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.15) : AppColors.surfaceWarm,
          borderRadius: BorderRadius.circular(AppRadius.chip),
          border: Border.all(color: selected ? color : Colors.transparent),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? color : AppColors.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

class _RoleChoice extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _RoleChoice({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary.withValues(alpha: 0.12) : AppColors.surfaceWarm,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: selected ? AppColors.primary : Colors.transparent),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? AppColors.primary : AppColors.textPrimary,
            fontWeight: FontWeight.w700,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}
