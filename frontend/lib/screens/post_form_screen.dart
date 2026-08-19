import 'dart:io';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

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
  final TextEditingController _petNameController = TextEditingController();
  final TextEditingController _breedController = TextEditingController();
  final TextEditingController _colorMarkingsController = TextEditingController();
  final TextEditingController _approximateAreaController = TextEditingController();
  final TextEditingController _circumstancesController = TextEditingController();
  final TextEditingController _ageController = TextEditingController();
  final TextEditingController _healthNotesController = TextEditingController();
  final TextEditingController _additionalRequirementsController = TextEditingController();
  final List<XFile> _images = [];
  String? _selectedCategory;

  String? _species;
  String? _urgency;
  String? _role;
  String? _condition;
  bool _isFree = false;
  bool _openToOffers = false;
  bool _hasCollarWithIdTag = false;
  DateTime? _dateLastSeen;
  String? _gender;
  bool _vaccinated = false;
  bool _neutered = false;
  final Set<String> _personalityTags = {};
  String? _spaceRequirement;
  bool _priorPetExperienceRequired = false;
  String? _contactPrivacy;
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

  static const Color _lostPetAccent = Color(0xFFE08A2E);

  static const List<Choice> _adoptionSpeciesOptions = [
    ('CAT', 'Cat', 'قطة'),
    ('DOG', 'Dog', 'كلب'),
    ('OTHER', 'Other', 'أخرى'),
  ];

  static const List<Choice> _genderOptions = [
    ('FEMALE', 'Female', 'أنثى'),
    ('MALE', 'Male', 'ذكر'),
  ];

  static const List<Choice> _personalityOptions = [
    ('PLAYFUL', 'Playful', 'مرح'),
    ('GENTLE', 'Gentle', 'لطيف'),
    ('INDOOR', 'Indoor', 'داخلي'),
    ('OUTDOOR', 'Outdoor', 'خارجي'),
    ('GOOD_WITH_KIDS', 'Good with kids', 'يتوافق مع الأطفال'),
    ('GOOD_WITH_CATS', 'Good with cats', 'يتوافق مع القطط'),
    ('GOOD_WITH_DOGS', 'Good with dogs', 'يتوافق مع الكلاب'),
    ('SHY', 'Shy', 'خجول'),
    ('ENERGETIC', 'Energetic', 'نشيط'),
    ('CALM', 'Calm', 'هادئ'),
  ];

  static const List<Choice> _spaceOptions = [
    ('APARTMENT_OK', 'Apartment OK', 'شقة مناسبة'),
    ('NEEDS_YARD', 'Needs outdoor access', 'يحتاج مساحة خارجية'),
    ('NEEDS_FARM_OR_LARGE_SPACE', 'Large garden required', 'يتطلب حديقة كبيرة'),
  ];

  static const List<Choice> _contactPrivacyOptions = [
    ('PUBLIC', 'Show my phone number publicly', 'إظهار رقم هاتفي للجميع'),
    ('PRIVATE', 'Keep private — receive contact requests', 'إبقاؤه خاصًا — استلام طلبات تواصل'),
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

  String _labelFor(List<Choice> options, String value) {
    final match = options.firstWhere((o) => o.$1 == value);
    return t(context, match.$2, match.$3);
  }

  Future<void> _pickImage() async {
    if (_images.length >= 4) return;
    // Downscale + re-encode at pick time so we never upload a full-resolution
    // camera photo (can be 10+ MB) — keeps uploads fast and comfortably under
    // the backend's 5MB-per-image limit.
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 80,
    );
    if (picked != null) setState(() => _images.add(picked));
  }

  bool get _rescueFormValid {
    // condition text feeds both `description` (backend min 10) and
    // `conditionSummary` (backend min 5) — 10 is the binding constraint.
    return _images.isNotEmpty &&
        _species != null &&
        _conditionController.text.trim().length >= 10 &&
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
    if (!mounted) return null;
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
      if (!mounted) return null;
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

  bool get _lostPetFormValid {
    return _images.isNotEmpty &&
        _species != null &&
        _petNameController.text.trim().isNotEmpty &&
        _approximateAreaController.text.trim().isNotEmpty &&
        _circumstancesController.text.trim().length >= 10 &&
        _dateLastSeen != null;
  }

  String _isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  String _displayDate(DateTime d) {
    const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${monthsEn[d.month - 1]} ${d.year}';
  }

  Future<void> _pickDateLastSeen() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateLastSeen ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
    );
    if (picked != null) setState(() => _dateLastSeen = picked);
  }

  bool get _adoptionFormValid {
    return _images.isNotEmpty &&
        _petNameController.text.trim().isNotEmpty &&
        _species != null &&
        _gender != null;
  }

  (int, String)? _parseAge(String text) {
    final match = RegExp(r'(\d+)').firstMatch(text);
    if (match == null) return null;
    final value = int.tryParse(match.group(1)!);
    if (value == null || value <= 0) return null;
    final lower = text.toLowerCase();
    String unit;
    if (lower.contains('year')) {
      unit = 'YEARS';
    } else if (lower.contains('month')) {
      unit = 'MONTHS';
    } else if (lower.contains('week')) {
      unit = 'WEEKS';
    } else if (lower.contains('day')) {
      unit = 'DAYS';
    } else {
      unit = 'YEARS';
    }
    return (value, unit);
  }

  String _ageUnitLabel(String unit) {
    switch (unit) {
      case 'DAYS':
        return t(context, 'days old', 'أيام');
      case 'WEEKS':
        return t(context, 'weeks old', 'أسابيع');
      case 'MONTHS':
        return t(context, 'months old', 'أشهر');
      case 'YEARS':
        return t(context, 'years old', 'سنوات');
      default:
        return '';
    }
  }

  bool get _productFormValid {
    return _images.isNotEmpty &&
        _productTitleController.text.trim().length >= 3 &&
        _captionController.text.trim().length >= 10 &&
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
      if (!mounted) return;

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
        if (!mounted) return;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
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
      if (!mounted) return;

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
      if (!mounted) return;

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
        if (!mounted) return;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
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
      if (!mounted) return;

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

  Future<void> _submitLostPet() async {
    if (!_lostPetFormValid || _submitting) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

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
        if (!mounted) return;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final petName = _petNameController.text.trim();
      final speciesLabel = _labelFor(_speciesOptions, _species!);
      final circumstances = _circumstancesController.text.trim();

      final result = await graphql.createLostPost(
        title: '${t(context, 'Lost', 'مفقود')} $speciesLabel: $petName',
        description: circumstances,
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: _approximateAreaController.text.trim(),
        urgency: 'URGENT',
        reportType: 'LOST_PET',
        species: _species!,
        breed: _breedController.text.trim(),
        colorAndMarkings: _colorMarkingsController.text.trim(),
        hasCollarWithIdentificationTag: _hasCollarWithIdTag,
        circumstances: circumstances,
        petName: petName,
        dateLastSeen: _dateLastSeen != null ? _isoDate(_dateLastSeen!) : null,
        mediaIds: mediaIds,
      );
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Lost pet report posted!', 'تم نشر بلاغ الحيوان المفقود!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: t(context, 'Failed to post report', 'فشل نشر البلاغ'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitAdoption() async {
    if (!_adoptionFormValid || _submitting) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

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
        if (!mounted) return;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final petName = _petNameController.text.trim();
      final breed = _breedController.text.trim();
      final speciesLabel = _labelFor(_adoptionSpeciesOptions, _species!);
      final genderLabel = _labelFor(_genderOptions, _gender!);
      final agePair = _parseAge(_ageController.text.trim());
      final ageText = agePair != null ? '${agePair.$1} ${_ageUnitLabel(agePair.$2)} ' : '';
      final breedText = breed.isEmpty ? '' : ' ($breed)';

      final description =
          '$petName ${t(context, 'is a', 'هو')} $ageText$genderLabel $speciesLabel$breedText '
          '${t(context, 'looking for a loving home.', 'يبحث عن منزل محب.')}';

      final result = await graphql.createAdoptionPost(
        title: '${t(context, 'Adoption', 'تبني')}: $petName',
        description: description,
        latitude: position.latitude,
        longitude: position.longitude,
        petName: petName,
        species: _species!,
        breed: breed.isEmpty ? null : breed,
        ageValue: agePair?.$1,
        ageUnit: agePair?.$2,
        gender: _gender!,
        vaccinated: _vaccinated,
        neutered: _neutered,
        healthNotes: _healthNotesController.text.trim().isEmpty ? null : _healthNotesController.text.trim(),
        personalityTags: _personalityTags.toList(),
        spaceRequirement: _spaceRequirement,
        priorPetExperienceRequired: _priorPetExperienceRequired,
        additionalRequirements: _additionalRequirementsController.text.trim().isEmpty
            ? null
            : _additionalRequirementsController.text.trim(),
        mediaIds: mediaIds,
      );
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Adoption listing posted!', 'تم نشر إعلان التبني!'));
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

  @override
  void dispose() {
    _captionController.dispose();
    _conditionController.dispose();
    _neighborhoodController.dispose();
    _landmarkController.dispose();
    _productTitleController.dispose();
    _priceController.dispose();
    _petNameController.dispose();
    _breedController.dispose();
    _colorMarkingsController.dispose();
    _approximateAreaController.dispose();
    _circumstancesController.dispose();
    _ageController.dispose();
    _healthNotesController.dispose();
    _additionalRequirementsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.type == PostType.rescue && widget.initialCategory == 'LOST') {
      return _buildLostPetForm(context);
    }
    if (widget.type == PostType.rescue) {
      return _buildRescueForm(context);
    }
    if (widget.type == PostType.product) {
      return _buildProductForm(context);
    }
    if (widget.type == PostType.adoption) {
      return _buildAdoptionForm(context);
    }
    // Every PostType value is handled above (rescue/LOST, rescue, product,
    // adoption) — PostFormScreen is never constructed with PostType.general.
    throw StateError('Unhandled PostType: ${widget.type}');
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
                            Text(t(context, 'Up to 4 photos', 'حتى 4 صور'), style: Theme.of(context).textTheme.bodySmall),
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
                                  if (_images.length < 4)
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

  Widget _buildLostPetForm(BuildContext context) {
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
                        Text(t(context, 'Report a Lost Pet', 'الإبلاغ عن حيوان مفقود'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(
                          t(context, 'Help reunite a pet with their family', 'ساعد في لم شمل حيوان أليف بعائلته'),
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Divider(height: 1, color: AppColors.border),
            ),
            const SizedBox(height: AppSpacing.sm),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                children: [
                  _SectionLabel(t(context, 'PET DETAILS', 'تفاصيل الحيوان')),
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
                              t(context, 'Add photos of your pet', 'أضف صورًا لحيوانك الأليف'),
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              t(context, 'Clear photos help with identification', 'الصور الواضحة تساعد في التعرف عليه'),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
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
                                  if (_images.length < 4)
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
                  Text(t(context, "Pet's name", 'اسم الحيوان'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _petNameController,
                    textCapitalization: TextCapitalization.words,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. Max', 'مثال: ماكس')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Breed', 'السلالة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _breedController,
                    decoration: _fieldDecoration(t(context, 'e.g. Golden Retriever', 'مثال: جولدن ريتريفر')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Color & markings', 'اللون والعلامات المميزة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _colorMarkingsController,
                    decoration: _fieldDecoration(
                      t(context, 'e.g. tan and white, spot on left ear', 'مثال: بني وأبيض، بقعة على الأذن اليسرى'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Has collar with ID tag', 'يرتدي طوقًا يحمل بطاقة تعريف')),
                    value: _hasCollarWithIdTag,
                    onChanged: (v) => setState(() => _hasCollarWithIdTag = v),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'WHEN & WHERE LAST SEEN', 'متى وأين شوهد آخر مرة')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Date last seen', 'تاريخ آخر مشاهدة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  InkWell(
                    onTap: _pickDateLastSeen,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceWarm,
                        borderRadius: BorderRadius.circular(AppRadius.card),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.calendar_today_outlined, size: 18, color: AppColors.textMuted),
                          const SizedBox(width: AppSpacing.sm),
                          Text(
                            _dateLastSeen != null ? _displayDate(_dateLastSeen!) : t(context, 'Select date', 'اختر التاريخ'),
                            style: TextStyle(
                              color: _dateLastSeen != null ? AppColors.textPrimary : AppColors.textMuted,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Approximate area', 'المنطقة التقريبية'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _approximateAreaController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. 7th Circle area', 'مثال: منطقة الدائرة السابعة')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Circumstances', 'الظروف'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _circumstancesController,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(
                      t(context, 'Describe when and how your pet went missing...', 'صف متى وكيف فُقد حيوانك الأليف...'),
                    ),
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
                      onPressed: (_lostPetFormValid && !_submitting) ? _submitLostPet : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _lostPetAccent,
                        disabledBackgroundColor: _lostPetAccent.withValues(alpha: 0.35),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            )
                          : Text(t(context, 'Post Lost Pet Report', 'نشر بلاغ الحيوان المفقود')),
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

  Widget _buildAdoptionForm(BuildContext context) {
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
                        Text(t(context, 'List Pet for Adoption', 'إعلان تبني حيوان'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(
                          t(context, 'Help find them a forever home', 'ساعد في إيجاد منزل دائم له'),
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Divider(height: 1, color: AppColors.border),
            ),
            const SizedBox(height: AppSpacing.sm),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                children: [
                  _SectionLabel(t(context, 'PET PROFILE', 'ملف الحيوان')),
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
                              t(context, 'Add pet photos', 'أضف صور الحيوان'),
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              t(context, 'Up to 4 photos — first is the cover', 'حتى 4 صور — الأولى هي الغلاف'),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
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
                                  if (_images.length < 4)
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
                  Text(t(context, "Pet's name", 'اسم الحيوان'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _petNameController,
                    textCapitalization: TextCapitalization.words,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. Luna', 'مثال: لونا')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Species', 'النوع'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _adoptionSpeciesOptions.map((s) {
                      return _PillChoice(
                        label: t(context, s.$2, s.$3),
                        selected: _species == s.$1,
                        onTap: () => setState(() => _species = s.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Breed', 'السلالة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _breedController,
                    decoration: _fieldDecoration(t(context, 'e.g. Domestic shorthair', 'مثال: شيرازي محلي')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Age', 'العمر'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _ageController,
                    decoration: _fieldDecoration(t(context, 'e.g. 2 years', 'مثال: سنتان')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Gender', 'الجنس'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _genderOptions.map((g) {
                      return _PillChoice(
                        label: t(context, g.$2, g.$3),
                        selected: _gender == g.$1,
                        onTap: () => setState(() => _gender = g.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'HEALTH & CARE', 'الصحة والرعاية')),
                  const SizedBox(height: AppSpacing.md),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Vaccinated', 'مُطعَّم')),
                    value: _vaccinated,
                    onChanged: (v) => setState(() => _vaccinated = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Neutered / Spayed', 'مُعقَّم')),
                    value: _neutered,
                    onChanged: (v) => setState(() => _neutered = v),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(t(context, 'Health notes', 'ملاحظات صحية'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _healthNotesController,
                    maxLines: 3,
                    decoration: _fieldDecoration(
                      t(context, 'Any ongoing treatments, special dietary needs...', 'أي علاجات جارية أو احتياجات غذائية خاصة...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'PERSONALITY', 'الشخصية')),
                  const SizedBox(height: AppSpacing.xs),
                  Text(t(context, 'Select all that apply', 'اختر كل ما ينطبق'), style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _personalityOptions.map((p) {
                      final selected = _personalityTags.contains(p.$1);
                      return _PillChoice(
                        label: t(context, p.$2, p.$3),
                        selected: selected,
                        onTap: () => setState(() {
                          if (selected) {
                            _personalityTags.remove(p.$1);
                          } else {
                            _personalityTags.add(p.$1);
                          }
                        }),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'ADOPTION REQUIREMENTS', 'شروط التبني')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Space requirement', 'المساحة المطلوبة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _spaceOptions.map((s) {
                      return _PillChoice(
                        label: t(context, s.$2, s.$3),
                        selected: _spaceRequirement == s.$1,
                        onTap: () => setState(() => _spaceRequirement = s.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Prior pet experience required', 'يتطلب خبرة سابقة بالحيوانات')),
                    value: _priorPetExperienceRequired,
                    onChanged: (v) => setState(() => _priorPetExperienceRequired = v),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(t(context, 'Additional requirements', 'متطلبات إضافية'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _additionalRequirementsController,
                    maxLines: 3,
                    decoration: _fieldDecoration(
                      t(context, 'Anything a potential adopter should know...', 'أي شيء يجب أن يعرفه المتبني المحتمل...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  const Text('CONTACT PRIVACY  ·  خصوصية التواصل', style: TextStyle(fontWeight: FontWeight.w700, letterSpacing: 0.5, fontSize: 12, color: AppColors.textMuted)),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'How can adopters reach you?', 'كيف يمكن للمتبنين التواصل معك؟'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Column(
                    children: _contactPrivacyOptions.map((c) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: _RoleChoice(
                          label: t(context, c.$2, c.$3),
                          selected: _contactPrivacy == c.$1,
                          onTap: () => setState(() => _contactPrivacy = c.$1),
                        ),
                      );
                    }).toList(),
                  ),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceWarm,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                    ),
                    child: Text(
                      t(
                        context,
                        'If you keep your number private, interested adopters send you a message request. You decide whether to accept or decline before your number is shared.',
                        'إذا أبقيت رقمك خاصًا، سيرسل لك المتبنون المهتمون طلب تواصل. أنت من يقرر القبول أو الرفض قبل مشاركة رقمك.',
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
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
                      onPressed: (_adoptionFormValid && !_submitting) ? _submitAdoption : null,
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            )
                          : Text(t(context, 'List for Adoption', 'نشر إعلان التبني')),
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
                            Text(t(context, 'Up to 4 photos', 'حتى 4 صور'), style: Theme.of(context).textTheme.bodySmall),
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
                                  if (_images.length < 4)
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
    return Semantics(
      button: true,
      label: t(context, 'Back', 'رجوع'),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 40,
          height: 40,
          decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
          child: const Icon(Icons.chevron_left, color: AppColors.textPrimary),
        ),
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

/// Responsible Matching intake form.
///
/// There is no backend mutation for this yet — [AdoptionApplication] exists
/// only as a read type and a DB table, with no resolver to create one, and
/// its shape is per-listing (`targetPostId`) while this screen collects
/// general preferences with no specific pet targeted. This screen is a
/// working local-only mockup: submitting shows a confirmation and closes,
/// nothing is sent to the server.
class AdoptionMatchingScreen extends StatefulWidget {
  const AdoptionMatchingScreen({super.key});

  @override
  State<AdoptionMatchingScreen> createState() => _AdoptionMatchingScreenState();
}

class _AdoptionMatchingScreenState extends State<AdoptionMatchingScreen> {
  static const Color _matchingAccent = Color(0xFF8E7CC3);

  static const List<Choice> _speciesPrefOptions = [
    ('CAT', 'Cat', 'قطة'),
    ('DOG', 'Dog', 'كلب'),
    ('EITHER', 'Either', 'كلاهما'),
  ];

  static const List<Choice> _agePrefOptions = [
    ('KITTEN_PUPPY', 'Kitten / Puppy', 'صغير'),
    ('YOUNG_ADULT', 'Young adult', 'شاب'),
    ('ADULT', 'Adult', 'بالغ'),
    ('SENIOR', 'Senior', 'كبير السن'),
    ('NO_PREFERENCE', 'No preference', 'لا تفضيل'),
  ];

  static const List<Choice> _genderPrefOptions = [
    ('NO_PREFERENCE', 'No preference', 'لا تفضيل'),
    ('FEMALE', 'Female', 'أنثى'),
    ('MALE', 'Male', 'ذكر'),
  ];

  static const List<Choice> _livingSituationOptions = [
    ('APARTMENT', 'Apartment', 'شقة'),
    ('HOUSE_WITH_GARDEN', 'House with garden', 'منزل بحديقة'),
    ('HOUSE_WITH_LARGE_GARDEN', 'House with large garden', 'منزل بحديقة كبيرة'),
  ];

  static const List<Choice> _experienceOptions = [
    ('FIRST_TIME', 'First time owner', 'مالك لأول مرة'),
    ('SOME', 'Some experience', 'بعض الخبرة'),
    ('VERY', 'Very experienced', 'خبرة كبيرة'),
  ];

  final TextEditingController _breedPrefController = TextEditingController();
  final TextEditingController _hoursAtHomeController = TextEditingController();
  final TextEditingController _whyAdoptController = TextEditingController();

  String? _speciesPref;
  String? _agePref;
  String? _genderPref;
  String? _livingSituation;
  bool _hasOutdoorAccess = false;
  bool _hasOtherPets = false;
  bool _hasChildren = false;
  String? _experience;
  bool _consentHomeVisit = false;
  bool _canProvideVetReference = false;
  bool _submitting = false;

  @override
  void dispose() {
    _breedPrefController.dispose();
    _hoursAtHomeController.dispose();
    _whyAdoptController.dispose();
    super.dispose();
  }

  bool get _formValid {
    return _speciesPref != null &&
        _livingSituation != null &&
        _experience != null &&
        _whyAdoptController.text.trim().isNotEmpty;
  }

  Future<void> _submit() async {
    if (!_formValid || _submitting) return;
    setState(() => _submitting = true);
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    setState(() => _submitting = false);
    Fluttertoast.showToast(
      msg: t(
        context,
        "Application submitted! We'll review it within 2–5 business days.",
        'تم إرسال الطلب! سنراجعه خلال 2-5 أيام عمل.',
      ),
      backgroundColor: _matchingAccent,
      textColor: Colors.white,
    );
    Navigator.of(context).pop(true);
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

  @override
  Widget build(BuildContext context) {
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
                        Text(t(context, 'Responsible Matching', 'مطابقة مسؤولة'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(
                          t(context, 'Apply to adopt — verified & screened', 'قدّم طلب تبني — عملية موثوقة وفرز دقيق'),
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Divider(height: 1, color: AppColors.border),
            ),
            const SizedBox(height: AppSpacing.sm),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    decoration: BoxDecoration(
                      color: _matchingAccent.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(AppRadius.card),
                      border: Border.all(color: _matchingAccent.withValues(alpha: 0.25)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t(context, 'Responsible Matching', 'مطابقة مسؤولة'),
                          style: TextStyle(color: _matchingAccent, fontWeight: FontWeight.w700, fontSize: 15),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          t(
                            context,
                            'This process verifies adopters through a home profile review, optional home visit, and vet reference check. Applications are reviewed within 2–5 business days.',
                            'تتحقق هذه العملية من المتبنين عبر مراجعة الملف المنزلي، وزيارة منزلية اختيارية، وفحص مرجع بيطري. تتم مراجعة الطلبات خلال 2-5 أيام عمل.',
                          ),
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, "I'M LOOKING FOR", 'أبحث عن')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Species preference', 'تفضيل النوع'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _speciesPrefOptions.map((s) {
                      return _PillChoice(
                        label: t(context, s.$2, s.$3),
                        selected: _speciesPref == s.$1,
                        onTap: () => setState(() => _speciesPref = s.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Breed preference', 'تفضيل السلالة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _breedPrefController,
                    decoration: _fieldDecoration(t(context, 'Leave blank if flexible', 'اتركه فارغًا إذا كنت مرنًا')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Age preference', 'تفضيل العمر'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _agePrefOptions.map((a) {
                      return _PillChoice(
                        label: t(context, a.$2, a.$3),
                        selected: _agePref == a.$1,
                        onTap: () => setState(() => _agePref = a.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Gender preference', 'تفضيل الجنس'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _genderPrefOptions.map((g) {
                      return _PillChoice(
                        label: t(context, g.$2, g.$3),
                        selected: _genderPref == g.$1,
                        onTap: () => setState(() => _genderPref = g.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'YOUR HOME & LIFESTYLE', 'منزلك وأسلوب حياتك')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Living situation', 'الوضع السكني'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _livingSituationOptions.map((l) {
                      return _PillChoice(
                        label: t(context, l.$2, l.$3),
                        selected: _livingSituation == l.$1,
                        onTap: () => setState(() => _livingSituation = l.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Has outdoor access', 'لديه وصول لمساحة خارجية')),
                    value: _hasOutdoorAccess,
                    onChanged: (v) => setState(() => _hasOutdoorAccess = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Other pets at home', 'حيوانات أخرى في المنزل')),
                    subtitle: Text(t(context, 'You can describe them below', 'يمكنك وصفها أدناه')),
                    value: _hasOtherPets,
                    onChanged: (v) => setState(() => _hasOtherPets = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'Children at home', 'أطفال في المنزل')),
                    subtitle: Text(t(context, 'Ages help us match appropriately', 'الأعمار تساعدنا في المطابقة المناسبة')),
                    value: _hasChildren,
                    onChanged: (v) => setState(() => _hasChildren = v),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    t(context, 'Hours at home per day (approx.)', 'ساعات التواجد بالمنزل يوميًا (تقريبًا)'),
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _hoursAtHomeController,
                    keyboardType: TextInputType.number,
                    decoration: _fieldDecoration(t(context, 'e.g. 8 hours', 'مثال: 8 ساعات')),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'YOUR EXPERIENCE', 'خبرتك')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Previous pet experience', 'خبرة سابقة مع الحيوانات'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _experienceOptions.map((e) {
                      return _PillChoice(
                        label: t(context, e.$2, e.$3),
                        selected: _experience == e.$1,
                        onTap: () => setState(() => _experience = e.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Why do you want to adopt?', 'لماذا تريد التبني؟'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _whyAdoptController,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(
                      t(context, 'Tell us about your motivation and what you can offer...', 'أخبرنا عن دافعك وما يمكنك تقديمه...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'SCREENING CONSENT', 'موافقة الفرز')),
                  const SizedBox(height: AppSpacing.md),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'I consent to a home visit', 'أوافق على زيارة منزلية')),
                    subtitle: Text(t(context, 'Optional but preferred by foster families', 'اختيارية لكنها مفضّلة لدى الأسر الحاضنة')),
                    value: _consentHomeVisit,
                    onChanged: (v) => setState(() => _consentHomeVisit = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(t(context, 'I can provide a vet reference', 'يمكنني تقديم مرجع بيطري')),
                    subtitle: Text(t(context, 'Or willingness to register with a local vet', 'أو الاستعداد للتسجيل لدى بيطري محلي')),
                    value: _canProvideVetReference,
                    onChanged: (v) => setState(() => _canProvideVetReference = v),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceWarm,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                    ),
                    child: Text(
                      t(
                        context,
                        'Your information is reviewed by the Pupzy verification team only. It is never shared with third parties or displayed publicly.',
                        'يتم مراجعة معلوماتك من قِبل فريق التحقق في Pupzy فقط. لا تتم مشاركتها أبدًا مع أطراف ثالثة أو عرضها للعامة.',
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
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
                      onPressed: (_formValid && !_submitting) ? _submit : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _matchingAccent,
                        disabledBackgroundColor: _matchingAccent.withValues(alpha: 0.35),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            )
                          : Text(t(context, 'Submit Application', 'إرسال الطلب')),
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
}
