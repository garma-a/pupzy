import 'dart:io';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/post.dart';
import '../services/graphql_service.dart';
import '../services/terms_gate.dart';
import '../theme/app_theme.dart';
import '../widgets/city_picker_sheet.dart';
import '../utils/age_parser.dart';
import '../utils/photo_privacy.dart';
import '../utils/presigned_upload.dart';
import '../widgets/yes_no_question.dart';

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
  final TextEditingController _termsSummaryController = TextEditingController();
  final TextEditingController _matingConditionsController = TextEditingController();
  final TextEditingController _citySearchController = TextEditingController();
  final List<XFile> _images = [];
  String? _selectedCategory;

  // MATING-only state
  List<Map<String, dynamic>> _cities = [];
  Map<String, dynamic>? _selectedCity;
  bool _loadingCities = false;
  bool _isPurebred = false;
  bool _hasPedigreeCertificate = false;
  bool _matingVaccinated = true;
  bool _matingDewormed = true;

  String? _species;
  String? _role;
  String? _condition;
  bool _isFree = false;
  bool _openToOffers = false;
  bool _hasCollarWithIdTag = false;
  DateTime? _dateLastSeen;
  // FOUND_STRAY-only state.
  DateTime? _dateFound;
  String? _foundStrayCondition;
  bool _foundStraySafeWithReporter = true;
  // RESCUE urgency signals — the server computes posts.urgency from these
  // rather than trusting a client-picked severity tier.
  // Rescue urgency answers start unanswered (null): they set how urgent the
  // alert is, so a hurried reporter must answer each one rather than post
  // with a silent default.
  bool? _isLifeThreatening;
  bool? _hasVisibleSeriousInjury;
  bool? _isInDangerousLocation;
  bool? _canAnimalMoveOrEscape;

  bool get _rescueSituationAnswered =>
      _isLifeThreatening != null &&
      _hasVisibleSeriousInjury != null &&
      _isInDangerousLocation != null &&
      _canAnimalMoveOrEscape != null;
  // LOST_PET urgency signals — same idea, different questions.
  // Lost-pet urgency answers start unanswered too, for the same reason as
  // the rescue ones: each must be a deliberate answer, not a default.
  bool? _hasMedicalNeeds;
  bool? _isElderlyOrVeryYoung;
  bool? _lastSeenNearHazard;

  bool get _lostPetSituationAnswered =>
      _hasMedicalNeeds != null && _isElderlyOrVeryYoung != null && _lastSeenNearHazard != null;
  String? _gender;
  bool _vaccinated = false;
  bool _neutered = false;
  final Set<String> _personalityTags = {};
  String? _spaceRequirement;
  bool _priorPetExperienceRequired = false;
  bool _submitting = false;

  static const List<Choice> _speciesOptions = [
    ('DOG', 'Dog', 'كلب'),
    ('CAT', 'Cat', 'قطة'),
    ('OTHER', 'Other', 'أخرى'),
  ];

  static const List<Choice> _roleOptions = [
    ('REPORTING', "Reporting — I saw it but can't stay", 'مُبلّغ — رأيت الحيوان لكن لا أستطيع البقاء'),
    ('ON_SITE', "On-site — I'm with the animal", 'في الموقع — أنا مع الحيوان'),
    ('CAN_TRANSPORT', 'Can transport — I have a vehicle', 'يمكنني النقل — لدي وسيلة نقل'),
  ];

  static const Color _lostPetAccent = Color(0xFFE08A2E);

  static const List<Choice> _foundStrayConditionOptions = [
    ('HEALTHY', 'Healthy', 'بصحة جيدة'),
    ('INJURED', 'Injured', 'مصاب'),
    ('UNKNOWN', 'Not sure', 'غير متأكد'),
  ];

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

  static const List<Choice> _conditionOptions = [
    ('NEW', 'New', 'جديد'),
    ('LIKE_NEW', 'Like New', 'شبه جديد'),
    ('USED', 'Used', 'مستعمل'),
  ];

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialCategory;
    if (widget.type == PostType.mating) {
      _loadCities();
    }
  }

  Future<void> _loadCities() async {
    setState(() => _loadingCities = true);
    final graphql = context.read<GraphQLService>();
    final cities = await graphql.fetchCities();
    if (!mounted) return;
    setState(() {
      _cities = cities;
      _loadingCities = false;
    });
  }

  void _showCityPicker() {
    _citySearchController.clear();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return CityPickerSheet(
          cities: _cities,
          searchController: _citySearchController,
          title: t(context, "Select your pet's city", 'اختر مدينة حيوانك'),
          onSelected: (city) {
            setState(() => _selectedCity = city);
            Navigator.of(ctx).pop();
          },
        );
      },
    );
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
      case PostType.mating:
        // Mating has no generic "category" concept — species/breed/gender are
        // captured by their own dedicated fields in _buildMatingForm.
        return const [];
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
        _neighborhoodController.text.trim().isNotEmpty &&
        _role != null &&
        _rescueSituationAnswered;
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
        _dateLastSeen != null &&
        _lostPetSituationAnswered;
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

  bool get _foundStrayFormValid {
    return _images.isNotEmpty &&
        _species != null &&
        _approximateAreaController.text.trim().isNotEmpty &&
        _circumstancesController.text.trim().length >= 10 &&
        _foundStrayCondition != null &&
        _dateFound != null;
  }

  Future<void> _pickDateFound() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateFound ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
    );
    if (picked != null) setState(() => _dateFound = picked);
  }

  bool get _adoptionFormValid {
    return _images.isNotEmpty &&
        _petNameController.text.trim().isNotEmpty &&
        _species != null &&
        _gender != null;
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
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final (bytes, contentType) = await photoForUpload(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final uploaded = await putToPresignedUrl(uploadInfo['uploadUrl'] as String, bytes, contentType);
        if (!mounted) return;
        if (uploaded) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final neighborhood = _neighborhoodController.text.trim();
      final landmark = _landmarkController.text.trim();
      final areaName = landmark.isEmpty ? neighborhood : '$neighborhood — near $landmark';

      final (result, errorMessage) = await withTermsRecovery(context, () => graphql.createProductPost(
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
      ));
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Listing posted!', 'تم نشر الإعلان!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: errorMessage ?? t(context, 'Failed to post listing', 'فشل نشر الإعلان'),
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
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final (bytes, contentType) = await photoForUpload(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final uploaded = await putToPresignedUrl(uploadInfo['uploadUrl'] as String, bytes, contentType);
        if (!mounted) return;
        if (uploaded) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final neighborhood = _neighborhoodController.text.trim();
      final landmark = _landmarkController.text.trim();
      final areaName = landmark.isEmpty ? neighborhood : '$neighborhood — near $landmark';
      final condition = _conditionController.text.trim();
      final speciesLabel = _labelFor(_speciesOptions, _species!);

      final (result, errorMessage) = await withTermsRecovery(context, () => graphql.createRescuePost(
        title: '${t(context, 'Rescue', 'إنقاذ')}: $speciesLabel',
        description: condition,
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: areaName.isEmpty ? null : areaName,
        species: _species!,
        conditionSummary: condition,
        reporterRole: _role!,
        isLifeThreatening: _isLifeThreatening!,
        hasVisibleSeriousInjury: _hasVisibleSeriousInjury!,
        isInDangerousLocation: _isInDangerousLocation!,
        canAnimalMoveOrEscape: _canAnimalMoveOrEscape!,
        mediaIds: mediaIds,
      ));
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Rescue alert posted!', 'تم نشر تنبيه الإنقاذ!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: errorMessage ?? t(context, 'Failed to post rescue alert', 'فشل نشر تنبيه الإنقاذ'),
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
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final (bytes, contentType) = await photoForUpload(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final uploaded = await putToPresignedUrl(uploadInfo['uploadUrl'] as String, bytes, contentType);
        if (!mounted) return;
        if (uploaded) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final petName = _petNameController.text.trim();
      final speciesLabel = _labelFor(_speciesOptions, _species!);
      final circumstances = _circumstancesController.text.trim();

      final (result, errorMessage) = await withTermsRecovery(context, () => graphql.createLostPost(
        title: '${t(context, 'Lost', 'مفقود')} $speciesLabel: $petName',
        description: circumstances,
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: _approximateAreaController.text.trim(),
        reportType: 'LOST_PET',
        species: _species!,
        breed: _breedController.text.trim(),
        colorAndMarkings: _colorMarkingsController.text.trim(),
        hasCollarWithIdentificationTag: _hasCollarWithIdTag,
        circumstances: circumstances,
        petName: petName,
        dateLastSeen: _dateLastSeen != null ? _isoDate(_dateLastSeen!) : null,
        hasMedicalNeeds: _hasMedicalNeeds,
        isElderlyOrVeryYoung: _isElderlyOrVeryYoung,
        lastSeenNearHazard: _lastSeenNearHazard,
        mediaIds: mediaIds,
      ));
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Lost pet report posted!', 'تم نشر بلاغ الحيوان المفقود!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: errorMessage ?? t(context, 'Failed to post report', 'فشل نشر البلاغ'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitFoundStray() async {
    if (!_foundStrayFormValid || _submitting) return;
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final (bytes, contentType) = await photoForUpload(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final uploaded = await putToPresignedUrl(uploadInfo['uploadUrl'] as String, bytes, contentType);
        if (!mounted) return;
        if (uploaded) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final speciesLabel = _labelFor(_speciesOptions, _species!);
      final circumstances = _circumstancesController.text.trim();

      final (result, errorMessage) = await withTermsRecovery(context, () => graphql.createLostPost(
        title: '${t(context, 'Found', 'تم العثور على')} $speciesLabel',
        description: circumstances,
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: _approximateAreaController.text.trim(),
        reportType: 'FOUND_STRAY',
        species: _species!,
        breed: _breedController.text.trim(),
        colorAndMarkings: _colorMarkingsController.text.trim(),
        hasCollarWithIdentificationTag: _hasCollarWithIdTag,
        circumstances: circumstances,
        currentCondition: _foundStrayCondition!,
        isCurrentlySafeWithReporter: _foundStraySafeWithReporter,
        dateFound: _isoDate(_dateFound!),
        mediaIds: mediaIds,
      ));
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Found pet report posted!', 'تم نشر بلاغ الحيوان الذي تم العثور عليه!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: errorMessage ?? t(context, 'Failed to post report', 'فشل نشر البلاغ'),
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
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    setState(() => _submitting = true);

    try {
      Fluttertoast.showToast(msg: t(context, 'Getting your location...', 'جارٍ تحديد موقعك...'));
      final position = await _getCurrentPosition();
      if (position == null) return;
      if (!mounted) return;

      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final (bytes, contentType) = await photoForUpload(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final uploaded = await putToPresignedUrl(uploadInfo['uploadUrl'] as String, bytes, contentType);
        if (!mounted) return;
        if (uploaded) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }

      final petName = _petNameController.text.trim();
      final breed = _breedController.text.trim();
      final speciesLabel = _labelFor(_adoptionSpeciesOptions, _species!);
      final genderLabel = _labelFor(_genderOptions, _gender!);
      final agePair = parseAge(_ageController.text.trim());
      final ageText = agePair != null ? '${agePair.$1} ${_ageUnitLabel(agePair.$2)} ' : '';
      final breedText = breed.isEmpty ? '' : ' ($breed)';

      final description =
          '$petName ${t(context, 'is a', 'هو')} $ageText$genderLabel $speciesLabel$breedText '
          '${t(context, 'looking for a loving home.', 'يبحث عن منزل محب.')}';

      final (result, errorMessage) = await withTermsRecovery(context, () => graphql.createAdoptionPost(
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
      ));
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Adoption listing posted!', 'تم نشر إعلان التبني!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: errorMessage ?? t(context, 'Failed to post listing', 'فشل نشر الإعلان'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  bool get _matingFormValid {
    return _images.isNotEmpty &&
        _petNameController.text.trim().isNotEmpty &&
        _species != null &&
        _breedController.text.trim().isNotEmpty &&
        _gender != null &&
        parseAge(_ageController.text.trim()) != null &&
        _selectedCity != null;
  }

  Future<void> _submitMating() async {
    if (!_matingFormValid || _submitting) return;
    if (!await ensureTermsAccepted(context)) return;
    if (!mounted) return;
    setState(() => _submitting = true);

    try {
      final graphql = context.read<GraphQLService>();

      final mediaIds = <String>[];
      for (final image in _images) {
        final (bytes, contentType) = await photoForUpload(image);
        final uploadInfo = await graphql.requestMediaUploadUrl(
          contentType: contentType,
          fileSizeBytes: bytes.length,
        );
        if (uploadInfo == null) continue;
        final uploaded = await putToPresignedUrl(uploadInfo['uploadUrl'] as String, bytes, contentType);
        if (!mounted) return;
        if (uploaded) {
          mediaIds.add(uploadInfo['mediaId'] as String);
        } else {
          Fluttertoast.showToast(msg: t(context, 'One of your photos failed to upload and was skipped.', 'فشل رفع إحدى الصور وتم تخطيها.'));
        }
      }
      if (mediaIds.isEmpty) {
        Fluttertoast.showToast(
          msg: t(context, 'At least one photo is required', 'مطلوب صورة واحدة على الأقل'),
          backgroundColor: AppColors.critical,
          textColor: Colors.white,
        );
        return;
      }

      final agePair = parseAge(_ageController.text.trim())!;

      final (result, errorMessage) = await withTermsRecovery(context, () => graphql.createMatingPost(
        cityId: _selectedCity!['id'] as String,
        petName: _petNameController.text.trim(),
        species: _species!,
        breed: _breedController.text.trim(),
        gender: _gender!,
        ageValue: agePair.$1,
        ageUnit: agePair.$2,
        isPurebred: _isPurebred,
        hasPedigreeCertificate: _hasPedigreeCertificate,
        vaccinated: _matingVaccinated,
        dewormed: _matingDewormed,
        termsSummary: _termsSummaryController.text.trim().isEmpty ? null : _termsSummaryController.text.trim(),
        matingConditions: _matingConditionsController.text.trim().isEmpty ? null : _matingConditionsController.text.trim(),
        mediaIds: mediaIds,
      ));
      if (!mounted) return;

      if (result != null) {
        Fluttertoast.showToast(msg: t(context, 'Mating listing posted!', 'تم نشر إعلان التزاوج!'));
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: errorMessage ?? t(context, 'Failed to post listing', 'فشل نشر الإعلان'),
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
    _termsSummaryController.dispose();
    _matingConditionsController.dispose();
    _citySearchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Own pushed route — see account_suspended_screen.dart's comment for
    // why this direct dependency is needed for immediate language updates.
    context.watch<LangProvider>();
    if (widget.type == PostType.rescue && widget.initialCategory == 'LOST') {
      return _buildLostPetForm(context);
    }
    if (widget.type == PostType.rescue && widget.initialCategory == 'FOUND') {
      return _buildFoundStrayForm(context);
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
    if (widget.type == PostType.mating) {
      return _buildMatingForm(context);
    }
    // Every PostType value is handled above (rescue/LOST, rescue/FOUND, rescue,
    // product, adoption, mating) — PostFormScreen is never constructed with PostType.general.
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
                  Text(t(context, 'Situation check', 'تقييم الحالة'), style: Theme.of(context).textTheme.labelLarge),
                  Text(
                    t(
                      context,
                      "We use these answers to set the rescue's urgency. Answer each one.",
                      'نستخدم هذه الإجابات لتحديد مدى إلحاح الإنقاذ. أجب عن كل سؤال.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  YesNoQuestion(
                    question: t(context, "Is the animal's life in immediate danger?", 'هل حياة الحيوان في خطر مباشر؟'),
                    value: _isLifeThreatening,
                    onChanged: (v) => setState(() => _isLifeThreatening = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Does it have a visible serious injury?', 'هل لديه إصابة خطيرة واضحة؟'),
                    helper: t(context, "Heavy bleeding, a broken bone, or it can't stand", 'نزيف شديد، كسر، أو لا يستطيع الوقوف'),
                    value: _hasVisibleSeriousInjury,
                    onChanged: (v) => setState(() => _hasVisibleSeriousInjury = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Is it in a dangerous place right now?', 'هل هو في مكان خطر الآن؟'),
                    helper: t(context, 'On a road, at a construction site, or trapped', 'على طريق، في موقع بناء، أو محاصر'),
                    value: _isInDangerousLocation,
                    onChanged: (v) => setState(() => _isInDangerousLocation = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Can the animal move or escape on its own?', 'هل يستطيع الحيوان الحركة أو الهرب بمفرده؟'),
                    value: _canAnimalMoveOrEscape,
                    onChanged: (v) => setState(() => _canAnimalMoveOrEscape = v),
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
                      // Name the usual blocker: the situation questions sit
                      // mid-form and are easy to scroll past.
                      _rescueSituationAnswered
                          ? t(context, 'Complete all required fields to post', 'أكمل جميع الحقول المطلوبة للنشر')
                          : t(
                              context,
                              'Answer all 4 Situation check questions to post',
                              'أجب عن أسئلة تقييم الحالة الأربعة للنشر',
                            ),
                      style: Theme.of(context).textTheme.bodySmall,
                      textAlign: TextAlign.center,
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
                  YesNoQuestion(
                    question: t(context, 'Does it wear a collar with an ID tag?', 'هل يرتدي طوقًا يحمل بطاقة تعريف؟'),
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
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Situation check', 'تقييم الحالة'), style: Theme.of(context).textTheme.labelLarge),
                  Text(
                    t(
                      context,
                      'We use these answers to set how urgent this report is. Answer each one.',
                      'نستخدم هذه الإجابات لتحديد مدى إلحاح هذا البلاغ. أجب عن كل سؤال.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  YesNoQuestion(
                    question: t(context, 'Does it need regular medication or have a medical condition?', 'هل يحتاج دواءً منتظمًا أو لديه حالة طبية؟'),
                    value: _hasMedicalNeeds,
                    onChanged: (v) => setState(() => _hasMedicalNeeds = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Is it elderly or very young?', 'هل هو كبير في السن أو صغير جدًا؟'),
                    value: _isElderlyOrVeryYoung,
                    onChanged: (v) => setState(() => _isElderlyOrVeryYoung = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Was it last seen near a busy road, canal, or other hazard?', 'هل شوهد آخر مرة قرب طريق مزدحم أو ترعة أو خطر آخر؟'),
                    value: _lastSeenNearHazard,
                    onChanged: (v) => setState(() => _lastSeenNearHazard = v),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Center(
                    child: Text(
                      _lostPetSituationAnswered
                          ? t(context, 'Complete all required fields to post', 'أكمل جميع الحقول المطلوبة للنشر')
                          : t(
                              context,
                              'Answer all 3 Situation check questions to post',
                              'أجب عن أسئلة تقييم الحالة الثلاثة للنشر',
                            ),
                      style: Theme.of(context).textTheme.bodySmall,
                      textAlign: TextAlign.center,
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

  Widget _buildFoundStrayForm(BuildContext context) {
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
                        Text(t(context, 'Report a Found Pet', 'الإبلاغ عن حيوان تم العثور عليه'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(
                          t(context, 'Help this animal find its way home', 'ساعد هذا الحيوان في العودة إلى منزله'),
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
                            Text(
                              t(context, 'Clear photos help the owner recognize it', 'الصور الواضحة تساعد المالك على التعرف عليه'),
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
                  Text(t(context, 'Breed (if known)', 'السلالة (إن عُرفت)'), style: Theme.of(context).textTheme.labelLarge),
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
                  YesNoQuestion(
                    question: t(context, 'Does it wear a collar with an ID tag?', 'هل يرتدي طوقًا يحمل بطاقة تعريف؟'),
                    value: _hasCollarWithIdTag,
                    onChanged: (v) => setState(() => _hasCollarWithIdTag = v),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'WHEN & WHERE FOUND', 'متى وأين تم العثور عليه')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Date found', 'تاريخ العثور عليه'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  InkWell(
                    onTap: _pickDateFound,
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
                            _dateFound != null ? _displayDate(_dateFound!) : t(context, 'Select date', 'اختر التاريخ'),
                            style: TextStyle(
                              color: _dateFound != null ? AppColors.textPrimary : AppColors.textMuted,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Area found', 'المنطقة التي تم العثور عليه فيها'), style: Theme.of(context).textTheme.labelLarge),
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
                      t(context, 'Describe where and how you found the animal...', 'صف أين وكيف عثرت على الحيوان...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'CURRENT CONDITION', 'الحالة الحالية')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Condition', 'الحالة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: _foundStrayConditionOptions.map((c) {
                      return _PillChoice(
                        label: t(context, c.$2, c.$3),
                        selected: _foundStrayCondition == c.$1,
                        onTap: () => setState(() => _foundStrayCondition = c.$1),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  YesNoQuestion(
                    question: t(context, 'Is it safe with you right now?', 'هل هو بأمان معك الآن؟'),
                    helper: t(context, 'Choose No if it ran off or you no longer have it', 'اختر «لا» إذا هرب أو لم يعد معك'),
                    value: _foundStraySafeWithReporter,
                    onChanged: (v) => setState(() => _foundStraySafeWithReporter = v),
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
                      onPressed: (_foundStrayFormValid && !_submitting) ? _submitFoundStray : null,
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
                          : Text(t(context, 'Post Found Pet Report', 'نشر بلاغ الحيوان الذي تم العثور عليه')),
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
                  YesNoQuestion(
                    question: t(context, 'Is it vaccinated?', 'هل هو مُطعَّم؟'),
                    value: _vaccinated,
                    onChanged: (v) => setState(() => _vaccinated = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Is it neutered or spayed?', 'هل هو مُعقَّم؟'),
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
                  YesNoQuestion(
                    question: t(context, 'Must adopters have prior pet experience?', 'هل يُشترط أن تكون لدى المتبنّي خبرة سابقة بالحيوانات؟'),
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
                  // Adoption contact is request-only on the server: a number is
                  // released solely through an approved Adoption Application.
                  // There is no per-post privacy setting to send, so this states
                  // the rule instead of offering a choice nothing can honour.
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceWarm,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.lock_outline, size: 18, color: AppColors.primary),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Text(
                            t(
                              context,
                              'Your phone number stays private. Interested adopters send you a request, and your number is shared only with the ones you approve.',
                              'رقم هاتفك يبقى خاصًا. يرسل لك المتبنون المهتمون طلبًا، ولا تتم مشاركة رقمك إلا مع من توافق عليهم.',
                            ),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
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

  Widget _buildMatingForm(BuildContext context) {
    final lang = context.watch<LangProvider>().lang;
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
                        Text(t(context, 'Find a Mate', 'البحث عن شريك'), style: Theme.of(context).textTheme.headlineMedium),
                        Text(
                          t(context, 'List your pet as a mating partner search', 'اعرض حيوانك للبحث عن شريك تزاوج'),
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
                    decoration: _fieldDecoration(t(context, 'e.g. Rex', 'مثال: ريكس')),
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
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. German Shepherd', 'مثال: جيرمن شيبرد')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Age', 'العمر'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _ageController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration(t(context, 'e.g. 2 years', 'مثال: سنتان')),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Gender', 'الجنس'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: 2),
                  Text(
                    t(context, "Your pet's gender — we'll search for the opposite", 'جنس حيوانك — سنبحث عن الجنس المقابل'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
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
                  _SectionLabel(t(context, 'PEDIGREE & HEALTH', 'النسب والصحة')),
                  const SizedBox(height: AppSpacing.md),
                  YesNoQuestion(
                    question: t(context, 'Is it purebred?', 'هل هو أصيل؟'),
                    value: _isPurebred,
                    onChanged: (v) => setState(() => _isPurebred = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Does it have a pedigree certificate?', 'هل لديه شهادة نسب؟'),
                    value: _hasPedigreeCertificate,
                    onChanged: (v) => setState(() => _hasPedigreeCertificate = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Is it vaccinated?', 'هل هو مُطعَّم؟'),
                    value: _matingVaccinated,
                    onChanged: (v) => setState(() => _matingVaccinated = v),
                  ),
                  YesNoQuestion(
                    question: t(context, 'Is it dewormed?', 'هل هو مُطهَّر من الديدان؟'),
                    value: _matingDewormed,
                    onChanged: (v) => setState(() => _matingDewormed = v),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'MATING TERMS', 'شروط التزاوج')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'Terms summary (optional)', 'ملخص الشروط (اختياري)'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _termsSummaryController,
                    maxLines: 2,
                    decoration: _fieldDecoration(
                      t(context, 'e.g. Pick of the litter, stud fee negotiable...', 'مثال: اختيار جرو من المولود، رسم قابل للتفاوض...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(t(context, 'Mating conditions (optional)', 'شروط التزاوج (اختياري)'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _matingConditionsController,
                    maxLines: 3,
                    decoration: _fieldDecoration(
                      t(context, 'Health checks required, preferred breed match...', 'فحوصات صحية مطلوبة، سلالة مفضلة للتزاوج...'),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel(t(context, 'LOCATION', 'الموقع')),
                  const SizedBox(height: AppSpacing.md),
                  Text(t(context, 'City', 'المدينة'), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  GestureDetector(
                    onTap: _loadingCities ? null : _showCityPicker,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceWarm,
                        borderRadius: BorderRadius.circular(AppRadius.card),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.location_city_outlined, color: AppColors.textMuted, size: 20),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _loadingCities
                                ? SizedBox(
                                    height: 18,
                                    width: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                                  )
                                : Text(
                                    _selectedCity != null
                                        ? (lang == Lang.ar ? _selectedCity!['nameArabic'] as String : _selectedCity!['nameEnglish'] as String)
                                        : t(context, 'Search and select a city', 'ابحث واختر مدينة'),
                                    style: TextStyle(
                                      color: _selectedCity != null ? AppColors.textPrimary : AppColors.textMuted,
                                      fontSize: 14,
                                    ),
                                  ),
                          ),
                          const Icon(Icons.search, color: AppColors.textMuted, size: 18),
                        ],
                      ),
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
                      onPressed: (_matingFormValid && !_submitting) ? _submitMating : null,
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                            )
                          : Text(t(context, 'Post Mating Listing', 'نشر إعلان التزاوج')),
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
                  YesNoQuestion(
                    question: t(context, 'Is it free (a giveaway)?', 'هل هو مجاني (تبرّع)؟'),
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
                  YesNoQuestion(
                    question: t(context, 'Are you open to offers?', 'هل السعر قابل للتفاوض؟'),
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

