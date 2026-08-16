import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/adoption_application.dart';
import '../models/post_detail.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/adoption_application_sheet.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/adoption_applications_owner_section.dart';
import '../widgets/nearby_vets_section.dart';
import '../widgets/pet_carousel.dart';
import '../widgets/skeleton_loader.dart';

class AdoptionDetailScreen extends StatefulWidget {
  final String postId;

  const AdoptionDetailScreen({super.key, required this.postId});

  @override
  State<AdoptionDetailScreen> createState() => _AdoptionDetailScreenState();
}

class _AdoptionDetailScreenState extends State<AdoptionDetailScreen> {
  bool _loading = true;
  String? _errorMessage;
  PostDetail? _post;
  AdoptionPostExtension? _ext;
  String? _myUserId;
  AdoptionApplication? _myApplication;

  bool get _isOwner => _myUserId != null && _post != null && _post!.creator.id == _myUserId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final meFuture = graphql.fetchMe();
    final (post, postError) = await graphql.fetchPostDetail(widget.postId);
    if (!mounted) return;
    if (postError != null || post == null) {
      setState(() {
        _loading = false;
        _errorMessage = postError ?? t(context, 'This listing is no longer available.', 'هذا الإعلان لم يعد متاحًا.');
      });
      return;
    }
    graphql.recordView(post.id);
    final me = await meFuture;
    _myUserId = me?['id'] as String?;
    if (_myUserId != post.creator.id) {
      final (mine, _) = await graphql.fetchMyAdoptionApplications(first: 50);
      if (!mounted) return;
      _myApplication = mine.where((a) => a.targetPostId == post.id).isEmpty ? null : mine.firstWhere((a) => a.targetPostId == post.id);
    }
    final (ext, extError) = await graphql.fetchAdoptionPostDetail(widget.postId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _post = post;
      _ext = ext;
      _errorMessage = ext == null ? extError : null;
    });
  }

  Future<void> _adopt() async {
    if (_myApplication != null) return;
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AdoptionApplicationSheet(postId: widget.postId),
    );
    if (submitted != true || !mounted) return;
    final graphql = context.read<GraphQLService>();
    final (mine, _) = await graphql.fetchMyAdoptionApplications(first: 50);
    if (!mounted) return;
    setState(() {
      _myApplication = mine.where((a) => a.targetPostId == widget.postId).isEmpty ? null : mine.firstWhere((a) => a.targetPostId == widget.postId);
    });
  }

  Future<bool> _toggleSave() async {
    if (_post == null) return false;
    final graphql = context.read<GraphQLService>();
    final (count, saved, error) = await graphql.toggleSave(_post!.id);
    if (!mounted) return false;
    if (error != null || count == null || saved == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update. Try again.', 'تعذر التحديث. حاول مرة أخرى.'));
      return false;
    }
    setState(() => _post = _post!.copyWith(saveCount: count, isSavedByMe: saved));
    return true;
  }

  String _applyButtonLabel(BuildContext context) {
    switch (_myApplication?.status) {
      case 'PENDING':
        return t(context, 'Application Sent ✓', 'تم إرسال الطلب ✓');
      case 'APPROVED':
        return t(context, 'Application Approved ✓', 'تمت الموافقة على الطلب ✓');
      case 'REJECTED':
        return t(context, 'Application Declined', 'تم رفض الطلب');
      default:
        return t(context, 'Ask to adopt', 'اطلب التبني');
    }
  }

  String _ageLabel(BuildContext context) {
    final value = _ext?.ageValue;
    final unit = _ext?.ageUnit;
    if (value == null || unit == null) return t(context, 'Age unknown', 'العمر غير معروف');
    final unitLabel = switch (unit) {
      'DAYS' => t(context, 'days', 'أيام'),
      'WEEKS' => t(context, 'weeks', 'أسابيع'),
      'MONTHS' => t(context, 'months', 'أشهر'),
      'YEARS' => t(context, 'years', 'سنوات'),
      _ => unit,
    };
    return '$value $unitLabel';
  }

  String _genderLabel(BuildContext context, String gender) {
    return switch (gender) {
      'MALE' => t(context, 'Male', 'ذكر'),
      'FEMALE' => t(context, 'Female', 'أنثى'),
      _ => t(context, 'Unknown', 'غير معروف'),
    };
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: SingleChildScrollView(child: DetailScreenSkeleton()));
    }
    if (_errorMessage != null || _post == null || _ext == null) {
      return Scaffold(
        appBar: AppBar(backgroundColor: Colors.transparent, elevation: 0),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  _errorMessage ?? t(context, 'Something went wrong.', 'حدث خطأ ما.'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.md),
                OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
              ],
            ),
          ),
        ),
      );
    }

    final post = _post!;
    final ext = _ext!;
    final images = post.mediaUrls.isNotEmpty ? post.mediaUrls : [''];
    final cityName = Localizations.localeOf(context).languageCode == 'ar' ? post.cityNameArabic : post.cityNameEnglish;
    final location = post.areaName != null ? '$cityName · ${post.areaName}' : cityName;

    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Stack(
                  children: [
                    PetCarousel(imageUrls: images, height: 340),
                    SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.sm),
                        child: CircleAvatar(
                          backgroundColor: Colors.black45,
                          child: IconButton(
                            icon: const Icon(Icons.arrow_back, color: Colors.white),
                            onPressed: () => Navigator.of(context).pop(),
                            tooltip: t(context, 'Back', 'رجوع'),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(ext.petName, style: Theme.of(context).textTheme.headlineLarge)),
                          Padding(
                            padding: const EdgeInsets.all(8),
                            child: AnimatedFavoriteIcon(
                              isSaved: post.isSavedByMe,
                              onToggle: _toggleSave,
                              semanticLabelOn: t(context, 'Remove from favorites', 'إزالة من المفضلة'),
                              semanticLabelOff: t(context, 'Add to favorites', 'إضافة إلى المفضلة'),
                              activeColor: AppColors.critical,
                              inactiveColor: AppColors.textSecondary,
                              size: 24,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: [
                          if (ext.breed != null) _InfoChip(icon: Icons.pets, label: ext.breed!),
                          _InfoChip(icon: Icons.cake_outlined, label: _ageLabel(context)),
                          _InfoChip(icon: Icons.male, label: _genderLabel(context, ext.gender)),
                          _InfoChip(icon: Icons.location_on_outlined, label: location),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: [
                          if (ext.vaccinated) _InfoChip(icon: Icons.vaccines_outlined, label: t(context, 'Vaccinated', 'مُطعّم')),
                          if (ext.neutered) _InfoChip(icon: Icons.check_circle_outline, label: t(context, 'Neutered', 'مُعقّم')),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'About', 'نبذة'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(post.description, style: Theme.of(context).textTheme.bodyMedium),
                      if (ext.healthNotes != null && ext.healthNotes!.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.lg),
                        Text(t(context, 'Health notes', 'ملاحظات صحية'), style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(ext.healthNotes!, style: Theme.of(context).textTheme.bodyMedium),
                      ],
                      if (post.vetClinics.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.lg),
                        NearbyVetsSection(clinics: post.vetClinics),
                      ],
                      if (_isOwner) ...[
                        const SizedBox(height: AppSpacing.lg),
                        AdoptionApplicationsOwnerSection(postId: post.id),
                      ],
                      const SizedBox(height: 96),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: _isOwner
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _myApplication == null ? _adopt : null,
                    child: Text(_applyButtonLabel(context)),
                  ),
                ),
              ),
            ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _InfoChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.background,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(AppRadius.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: AppColors.textSecondary),
          const SizedBox(width: 4),
          Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}
