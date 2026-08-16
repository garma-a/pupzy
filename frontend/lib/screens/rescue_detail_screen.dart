import 'dart:ui';

import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/contact_request.dart';
import '../models/post_detail.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/contact_request_sheet.dart';
import '../widgets/contact_requests_owner_section.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/nearby_vets_section.dart';
import '../widgets/pet_carousel.dart';
import '../widgets/skeleton_loader.dart';

class RescueDetailScreen extends StatefulWidget {
  final String postId;

  const RescueDetailScreen({super.key, required this.postId});

  @override
  State<RescueDetailScreen> createState() => _RescueDetailScreenState();
}

class _RescueDetailScreenState extends State<RescueDetailScreen> {
  bool _loading = true;
  String? _errorMessage;
  PostDetail? _post;
  RescuePostExtension? _rescueExt;
  LostPostExtension? _lostExt;
  bool _revealed = false;
  bool _reportedFound = false;
  bool _boosting = false;
  String? _myUserId;
  ContactRequest? _myContactRequest;

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
        _errorMessage = postError ?? t(context, 'This post is no longer available.', 'هذا المنشور لم يعد متاحًا.');
      });
      return;
    }
    graphql.recordView(post.id);
    final me = await meFuture;
    _myUserId = me?['id'] as String?;
    if (_myUserId != post.creator.id) {
      final (mine, _) = await graphql.fetchMyContactRequests(postId: post.id, first: 1);
      if (!mounted) return;
      _myContactRequest = mine.isNotEmpty ? mine.first : null;
    }

    if (post.postType == 'RESCUE') {
      final (ext, extError) = await graphql.fetchRescuePostDetail(widget.postId);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _post = post;
        _rescueExt = ext;
        _errorMessage = ext == null ? extError : null;
      });
    } else {
      final (ext, extError) = await graphql.fetchLostPostDetail(widget.postId);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _post = post;
        _lostExt = ext;
        _errorMessage = ext == null ? extError : null;
      });
    }
  }

  Future<void> _toggleBoost() async {
    if (_boosting || _post == null) return;
    setState(() => _boosting = true);
    final graphql = context.read<GraphQLService>();
    final (count, upvoted, error) = await graphql.toggleUpvote(_post!.id);
    if (!mounted) return;
    setState(() => _boosting = false);
    if (error != null || count == null || upvoted == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update boost. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.'));
      return;
    }
    setState(() => _post = _post!.copyWith(upvoteCount: count, isUpvotedByMe: upvoted));
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

  Future<void> _reportFound() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.background,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
        title: Text(t(ctx, 'Report this animal as found?', 'الإبلاغ عن العثور على هذا الحيوان؟')),
        content: Text(
          t(
            ctx,
            'This lets the community know the animal has been rescued or is no longer in distress.',
            'هذا يُعلم المجتمع أن الحيوان تم إنقاذه أو لم يعد في محنة.',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(t(ctx, 'Cancel', 'إلغاء'))),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(t(ctx, 'Report Found', 'الإبلاغ عن العثور عليه'))),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      setState(() => _reportedFound = true);
      Fluttertoast.showToast(msg: t(context, 'Found report submitted', 'تم إرسال بلاغ العثور'));
    }
  }

  Future<void> _contactRescue() async {
    final existing = _myContactRequest;
    if (existing == null) {
      final sent = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => ContactRequestSheet(postId: widget.postId),
      );
      if (sent != true || !mounted) return;
      final graphql = context.read<GraphQLService>();
      final (mine, _) = await graphql.fetchMyContactRequests(postId: widget.postId, first: 1);
      if (!mounted) return;
      setState(() => _myContactRequest = mine.isNotEmpty ? mine.first : null);
      return;
    }
    if (existing.status == 'APPROVED' && existing.whatsappLink != null) {
      final opened = await launchUrl(Uri.parse(existing.whatsappLink!), mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
      }
    }
  }

  Future<void> _openDirections() async {
    final post = _post;
    if (post == null || post.latitude == null || post.longitude == null) return;
    final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${post.latitude},${post.longitude}');
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open Google Maps', 'تعذر فتح خرائط جوجل'));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: SingleChildScrollView(child: DetailScreenSkeleton()));
    }
    if (_errorMessage != null || _post == null || (_rescueExt == null && _lostExt == null)) {
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
                    if (_revealed)
                      PetCarousel(imageUrls: images, height: 320)
                    else
                      _BlurredCarousel(
                        imageUrl: images.first,
                        height: 320,
                        onReveal: () => setState(() => _revealed = true),
                      ),
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
                          Expanded(child: Text(post.title, style: Theme.of(context).textTheme.headlineLarge)),
                          if (post.isUrgent)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 6),
                              decoration: BoxDecoration(
                                color: AppColors.critical,
                                borderRadius: BorderRadius.circular(AppRadius.chip),
                              ),
                              child: Text(
                                t(context, 'Urgent', 'عاجل'),
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: [
                          if (_rescueExt != null) _InfoChip(icon: Icons.pets, label: _speciesLabel(context, _rescueExt!.species)),
                          if (_lostExt != null) ...[
                            _InfoChip(icon: Icons.pets, label: _speciesLabel(context, _lostExt!.species)),
                            if (_lostExt!.breed != null) _InfoChip(icon: Icons.badge_outlined, label: _lostExt!.breed!),
                          ],
                          _InfoChip(icon: Icons.location_on_outlined, label: location),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'Details', 'التفاصيل'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(post.description, style: Theme.of(context).textTheme.bodyMedium),
                      if (_rescueExt != null) ...[
                        const SizedBox(height: AppSpacing.md),
                        Text(t(context, 'Condition', 'الحالة'), style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(_rescueExt!.conditionSummary, style: Theme.of(context).textTheme.bodyMedium),
                        const SizedBox(height: AppSpacing.md),
                        Text(t(context, 'Coordination', 'التنسيق'), style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(_reporterRoleLabel(context, _rescueExt!.reporterRole), style: Theme.of(context).textTheme.bodyMedium),
                      ],
                      if (_lostExt != null && _lostExt!.circumstances != null) ...[
                        const SizedBox(height: AppSpacing.md),
                        Text(t(context, 'Circumstances', 'الظروف'), style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(_lostExt!.circumstances!, style: Theme.of(context).textTheme.bodyMedium),
                      ],
                      const SizedBox(height: AppSpacing.lg),
                      Row(
                        children: [
                          Material(
                            color: Colors.transparent,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(AppRadius.chip),
                              onTap: _toggleBoost,
                              child: _BoostChip(
                                count: post.upvoteCount,
                                boosted: post.isUpvotedByMe,
                              ),
                            ),
                          ),
                          if (post.latitude != null && post.longitude != null) ...[
                            const SizedBox(width: AppSpacing.sm),
                            Material(
                              color: Colors.transparent,
                              child: InkWell(
                                borderRadius: BorderRadius.circular(AppRadius.chip),
                                onTap: _openDirections,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                                  decoration: BoxDecoration(
                                    color: AppColors.background,
                                    borderRadius: BorderRadius.circular(AppRadius.chip),
                                    border: Border.all(color: AppColors.border),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.directions_outlined, size: 15, color: AppColors.primary),
                                      const SizedBox(width: 5),
                                      Text(
                                        t(context, 'Get Directions', 'الاتجاهات'),
                                        style: const TextStyle(fontSize: 13, color: AppColors.primary, fontWeight: FontWeight.w500),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                          const Spacer(),
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
                      if (post.vetClinics.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.lg),
                        NearbyVetsSection(clinics: post.vetClinics),
                      ],
                      if (_isOwner) ...[
                        const SizedBox(height: AppSpacing.lg),
                        ContactRequestsOwnerSection(postId: post.id),
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
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _reportedFound ? null : _reportFound,
                  child: Text(
                    _reportedFound
                        ? t(context, 'Reported ✓', 'تم الإبلاغ ✓')
                        : t(context, 'Report Found', 'الإبلاغ عن العثور عليه'),
                  ),
                ),
              ),
              if (!_isOwner) ...[
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _myContactRequest?.status == 'PENDING' || _myContactRequest?.status == 'REJECTED' ? null : _contactRescue,
                    child: Text(_contactButtonLabel(context)),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _contactButtonLabel(BuildContext context) {
    switch (_myContactRequest?.status) {
      case 'PENDING':
        return t(context, 'Request Sent', 'تم إرسال الطلب');
      case 'APPROVED':
        return t(context, 'Message on WhatsApp', 'راسل عبر واتساب');
      case 'REJECTED':
        return t(context, 'Request Declined', 'تم رفض الطلب');
      default:
        return t(context, 'Contact', 'تواصل');
    }
  }

  String _speciesLabel(BuildContext context, String species) {
    return switch (species) {
      'DOG' => t(context, '🐕 Dog', '🐕 كلب'),
      'CAT' => t(context, '🐱 Cat', '🐱 قطة'),
      'BIRD' => t(context, '🐦 Bird', '🐦 طائر'),
      'RABBIT' => t(context, '🐰 Rabbit', '🐰 أرنب'),
      _ => t(context, 'Other', 'أخرى'),
    };
  }

  String _reporterRoleLabel(BuildContext context, String role) {
    return switch (role) {
      'REPORTING' => t(context, 'Spotted but reporter is no longer on site', 'شوهد الحيوان لكن المُبلّغ لم يعد في الموقع'),
      'ON_SITE' => t(context, 'Reporter is currently with the animal', 'المُبلّغ حاليًا مع الحيوان'),
      'CAN_TRANSPORT' => t(context, 'Reporter can transport the animal', 'يمكن للمُبلّغ نقل الحيوان'),
      _ => role,
    };
  }
}

class _BoostChip extends StatelessWidget {
  final int count;
  final bool boosted;
  const _BoostChip({required this.count, required this.boosted});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.arrow_upward, size: 15, color: boosted ? AppColors.primary : AppColors.textMuted),
          const SizedBox(width: 5),
          Text(
            '$count  ${boosted ? t(context, 'Boosted', 'مُعزَّز') : t(context, 'Boost', 'تعزيز')}',
            style: TextStyle(fontSize: 13, color: boosted ? AppColors.primary : AppColors.textMuted, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

class _BlurredCarousel extends StatelessWidget {
  final String imageUrl;
  final double height;
  final VoidCallback onReveal;

  const _BlurredCarousel({
    required this.imageUrl,
    required this.height,
    required this.onReveal,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onReveal,
      child: SizedBox(
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            ImageWithFallback(
              url: imageUrl,
              width: double.infinity,
              height: height,
            ),
            ClipRect(
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: Container(
                  color: Colors.black.withValues(alpha: 0.25),
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.visibility_outlined, color: Colors.white, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            t(context, 'Tap to see photo', 'اضغط لرؤية الصورة'),
                            style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
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
