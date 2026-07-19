import 'dart:io';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../data/mock_data.dart';
import '../models/post.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

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

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialCategory;
  }

  List<String> get _categories {
    switch (widget.type) {
      case PostType.adoption:
        return ['Dog', 'Puppy', 'Senior', 'Special Needs'];
      case PostType.rescue:
        return ['Urgent', 'Found', 'Lost', 'Needs Foster'];
      case PostType.product:
        return ['Care', 'Food', 'Transport', 'Accessories', 'Grooming', 'Medical Supplies', 'Other'];
      case PostType.general:
        return ['Funny', 'Cute', 'Training', 'Story'];
    }
  }

  String get _title {
    switch (widget.type) {
      case PostType.adoption:
        return 'New Adoption Listing';
      case PostType.rescue:
        return 'New Rescue Alert';
      case PostType.product:
        return 'New Product';
      case PostType.general:
        return 'New Post';
    }
  }

  Future<void> _pickImage() async {
    if (_images.length >= 5) return;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked != null) setState(() => _images.add(picked));
  }

  void _submit() {
    final caption = _captionController.text.trim();
    if (caption.isEmpty) {
      Fluttertoast.showToast(msg: 'Please add a caption');
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
    Fluttertoast.showToast(msg: 'Post submitted!');
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
        msg: 'Please enable location services',
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
          msg: 'Location permission denied',
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

  String _reporterRoleFor(String role) {
    switch (role) {
      case "On-site — I'm with the animal":
        return 'ON_SITE';
      case 'Can transport — I have a vehicle':
        return 'CAN_TRANSPORT';
      default:
        return 'REPORTING';
    }
  }

  String _productCategoryEnumFor(String label) {
    switch (label) {
      case 'Medical Supplies':
        return 'MEDICAL_SUPPLIES';
      default:
        return label.toUpperCase();
    }
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
      Fluttertoast.showToast(msg: 'Getting your location...');
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
        category: _productCategoryEnumFor(_selectedCategory!),
        condition: _condition!.toUpperCase().replaceAll(' ', '_'),
        priceAmount: _isFree ? null : double.tryParse(_priceController.text.trim()),
        isFree: _isFree,
        openToOffers: _openToOffers,
        mediaIds: mediaIds,
      );

      if (result != null) {
        Fluttertoast.showToast(msg: 'Listing posted!');
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: 'Failed to post listing',
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
      Fluttertoast.showToast(msg: 'Getting your location...');
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

      final result = await graphql.createRescuePost(
        title: '$_urgency rescue: $_species',
        description: condition,
        latitude: position.latitude,
        longitude: position.longitude,
        areaName: areaName.isEmpty ? null : areaName,
        urgency: _urgency!.toUpperCase(),
        species: _species!.toUpperCase(),
        conditionSummary: condition,
        reporterRole: _reporterRoleFor(_role!),
        mediaIds: mediaIds,
      );

      if (result != null) {
        Fluttertoast.showToast(msg: 'Rescue alert posted!');
        if (mounted) Navigator.of(context).pop();
      } else {
        Fluttertoast.showToast(
          msg: 'Failed to post rescue alert',
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
          Text('Photos', style: Theme.of(context).textTheme.headlineSmall),
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
          Text('Caption', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _captionController,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: 'Tell the community about it...',
              filled: true,
              fillColor: AppColors.background,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.card),
                borderSide: const BorderSide(color: AppColors.border),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Category', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            children: _categories.map((c) {
              final selected = _selectedCategory == c;
              return ChoiceChip(
                label: Text(c),
                selected: selected,
                selectedColor: AppColors.primary.withValues(alpha: 0.15),
                onSelected: (_) => setState(() => _selectedCategory = c),
              );
            }).toList(),
          ),
          const SizedBox(height: AppSpacing.xxl),
          ElevatedButton(
            onPressed: _submit,
            child: const SizedBox(width: double.infinity, child: Text('Submit', textAlign: TextAlign.center)),
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
                        Text('Post a Rescue Alert', style: Theme.of(context).textTheme.headlineMedium),
                        Text('Help an animal in distress', style: Theme.of(context).textTheme.bodyMedium),
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
                  _SectionLabel('ANIMAL DETAILS'),
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
                              'Add photos of the animal',
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text('Up to 5 photos', style: Theme.of(context).textTheme.bodySmall),
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
                  Text('Species', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: ['Dog', 'Cat', 'Other'].map((s) {
                      return _PillChoice(
                        label: s,
                        selected: _species == s,
                        onTap: () => setState(() => _species = s),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Condition description', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _conditionController,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: "Describe the animal's visible condition...",
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
                  Text('Urgency level', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      _UrgencyChoice(
                        label: 'Critical — needs help now',
                        selected: _urgency == 'Critical',
                        color: AppColors.critical,
                        onTap: () => setState(() => _urgency = 'Critical'),
                      ),
                      _UrgencyChoice(
                        label: 'Urgent — needs help soon',
                        selected: _urgency == 'Urgent',
                        color: AppColors.primary,
                        onTap: () => setState(() => _urgency = 'Urgent'),
                      ),
                      _UrgencyChoice(
                        label: 'Moderate — stable but needs care',
                        selected: _urgency == 'Moderate',
                        color: AppColors.textSecondary,
                        onTap: () => setState(() => _urgency = 'Moderate'),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel('LOCATION'),
                  const SizedBox(height: AppSpacing.md),
                  Text('Neighborhood or area', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _neighborhoodController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration('e.g. Maadi area'),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Nearby landmark', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _landmarkController,
                    decoration: _fieldDecoration('e.g. near Al-Razi pharmacy'),
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
                            'Exact address will never be shown publicly',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel('YOUR ROLE'),
                  const SizedBox(height: AppSpacing.md),
                  Text('I am', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Column(
                    children: [
                      'Reporting — I saw it but can\'t stay',
                      'On-site — I\'m with the animal',
                      'Can transport — I have a vehicle',
                    ].map((r) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: _RoleChoice(
                          label: r,
                          selected: _role == r,
                          onTap: () => setState(() => _role = r),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Center(
                    child: Text(
                      'Complete all required fields to post',
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
                          : const Text('Post Rescue Alert'),
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
                        Text('List a Product', style: Theme.of(context).textTheme.headlineMedium),
                        Text('Buyers contact you directly', style: Theme.of(context).textTheme.bodyMedium),
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
                  _SectionLabel('LISTING DETAILS'),
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
                              'Add photos of the item',
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 2),
                            Text('Up to 5 photos', style: Theme.of(context).textTheme.bodySmall),
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
                  Text('Title', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _productTitleController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration('e.g. Field carrier, barely used'),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Description', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _captionController,
                    maxLines: 3,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration('Describe the item, condition, and any details buyers should know...'),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Category', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: _categories.map((c) {
                      return _PillChoice(
                        label: c,
                        selected: _selectedCategory == c,
                        onTap: () => setState(() => _selectedCategory = c),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Condition', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: ['New', 'Like New', 'Used'].map((c) {
                      return _PillChoice(
                        label: c,
                        selected: _condition == c,
                        onTap: () => setState(() => _condition = c),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel('PRICE'),
                  const SizedBox(height: AppSpacing.md),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('List as free / giveaway'),
                    value: _isFree,
                    onChanged: (v) => setState(() => _isFree = v),
                  ),
                  if (!_isFree) ...[
                    const SizedBox(height: AppSpacing.sm),
                    TextField(
                      controller: _priceController,
                      keyboardType: TextInputType.number,
                      onChanged: (_) => setState(() {}),
                      decoration: _fieldDecoration('Price in EGP'),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.sm),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Open to offers'),
                    value: _openToOffers,
                    onChanged: (v) => setState(() => _openToOffers = v),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _SectionLabel('LOCATION'),
                  const SizedBox(height: AppSpacing.md),
                  Text('Neighborhood or area', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _neighborhoodController,
                    onChanged: (_) => setState(() {}),
                    decoration: _fieldDecoration('e.g. Maadi area'),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text('Nearby landmark', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: _landmarkController,
                    decoration: _fieldDecoration('e.g. near Al-Razi pharmacy'),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  Center(
                    child: Text(
                      'Complete all required fields to post',
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
                          : const Text('Post Listing'),
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
