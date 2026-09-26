import 'package:fluttertoast/fluttertoast.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/contact_request.dart';
import '../models/mating_detail.dart';
import '../models/post_detail.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/animated_boost_chip.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/comments_sheet.dart';
import '../widgets/contact_request_sheet.dart';
import '../widgets/contact_requests_owner_section.dart';
import '../widgets/nearby_vets_section.dart';
import '../widgets/owner_post_actions.dart';
import '../utils/post_status_labels.dart';
import '../widgets/pet_carousel.dart';
import '../widgets/safety_actions.dart';
import '../widgets/skeleton_loader.dart';

/// Detail screen for a MATING post — a pet owner searching for a mating
/// partner (they keep their pet; this isn't an adoption listing). Reuses
/// the same WhatsApp contact-request handshake as rescue/lost posts.
class MatingDetailScreen extends StatefulWidget {
  final String postId;

  const MatingDetailScreen({super.key, required this.postId});

  @override
  State<MatingDetailScreen> createState() => _MatingDetailScreenState();
}

class _MatingDetailScreenState extends State<MatingDetailScreen> {
  bool _loading = true;
  String? _errorMessage;
  PostDetail? _post;
  MatingDetails? _ext;
  String? _myUserId;
  ContactRequest? _myContactRequest;
  bool _openingWhatsApp = false;

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
      final mine = (await graphql.fetchMyContactRequests(postId: post.id, first: 1)).items;
      if (!mounted) return;
      _myContactRequest = mine.isNotEmpty ? mine.first : null;
    }
    final (ext, extError) = await graphql.fetchMatingPostDetail(widget.postId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _post = post;
      _ext = ext;
      _errorMessage = ext == null ? extError : null;
    });
  }

  Future<bool> _toggleBoost() async {
    if (_post == null) return false;
    final graphql = context.read<GraphQLService>();
    final (count, upvoted, error) = await graphql.toggleUpvote(_post!.id);
    if (!mounted) return false;
    if (error != null || count == null || upvoted == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update raise. Try again.', 'تعذر تحديث التعزيز. حاول مرة أخرى.'));
      return false;
    }
    setState(() => _post = _post!.copyWith(upvoteCount: count, isUpvotedByMe: upvoted));
    return true;
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

  /// New contact requests are only accepted while the Post is ACTIVE. An
  /// already-approved requester keeps WhatsApp access after it closes.
  bool get _acceptsNewRequests => _post?.status == 'ACTIVE';

  /// Re-reads the Post's status after a request didn't go through — it may
  /// have closed while this screen was open, and the button should say so.
  Future<void> _refreshStatus() async {
    final (fresh, _) = await context.read<GraphQLService>().fetchPostDetail(widget.postId);
    if (!mounted || fresh == null || _post == null || fresh.status == _post!.status) return;
    setState(() => _post = _post!.copyWith(status: fresh.status));
  }

  Future<void> _contactOwner() async {
    final existing = _myContactRequest;
    if (existing == null) {
      if (!_acceptsNewRequests) return;
      final sent = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => ContactRequestSheet(postId: widget.postId),
      );
      if (!mounted) return;
      if (sent != true) {
        await _refreshStatus();
        return;
      }
      final graphql = context.read<GraphQLService>();
      final mine = (await graphql.fetchMyContactRequests(postId: widget.postId, first: 1)).items;
      if (!mounted) return;
      setState(() => _myContactRequest = mine.isNotEmpty ? mine.first : null);
      return;
    }
    if (existing.status != 'APPROVED' || _openingWhatsApp) return;
    // See rescue_detail_screen: `whatsappLink` is never populated on the
    // requester's own list, so fetch it on demand.
    setState(() => _openingWhatsApp = true);
    final graphql = context.read<GraphQLService>();
    final (link, error) = await graphql.getWhatsAppLink(existing.id);
    if (!mounted) return;
    setState(() => _openingWhatsApp = false);
    if (link == null) {
      Fluttertoast.showToast(msg: error ?? t(context, "This content isn't available.", 'هذا المحتوى غير متاح.'));
      return;
    }
    final opened = await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  String _contactButtonLabel(BuildContext context) {
    switch (_myContactRequest?.status) {
      case 'PENDING':
        return t(context, 'Request Sent ✓', 'تم إرسال الطلب ✓');
      case 'APPROVED':
        return t(context, 'Message on WhatsApp', 'راسل عبر واتساب');
      case 'REJECTED':
        return t(context, 'Request Declined', 'تم رفض الطلب');
      default:
        return _acceptsNewRequests
            ? t(context, 'Contact Owner', 'تواصل مع المالك')
            : closedToNewRequestsLabel(context, _post!.status);
    }
  }

  String _speciesLabel(BuildContext context, String species) {
    return switch (species) {
      'DOG' => t(context, 'Dog', 'كلب'),
      'CAT' => t(context, 'Cat', 'قطة'),
      'BIRD' => t(context, 'Bird', 'طائر'),
      'RABBIT' => t(context, 'Rabbit', 'أرنب'),
      _ => t(context, 'Other', 'أخرى'),
    };
  }

  String _genderLabel(BuildContext context, String gender) {
    return switch (gender) {
      'MALE' => t(context, 'Male', 'ذكر'),
      'FEMALE' => t(context, 'Female', 'أنثى'),
      _ => t(context, 'Unknown', 'غير معروف'),
    };
  }

  String _ageLabel(BuildContext context, int value, String unit) {
    final unitLabel = switch (unit) {
      'DAYS' => t(context, 'days', 'أيام'),
      'WEEKS' => t(context, 'weeks', 'أسابيع'),
      'MONTHS' => t(context, 'months', 'أشهر'),
      'YEARS' => t(context, 'years', 'سنوات'),
      _ => unit,
    };
    return '$value $unitLabel';
  }

  @override
  Widget build(BuildContext context) {
    // Own pushed route — see account_suspended_screen.dart's comment for
    // why this direct dependency is needed for immediate language updates.
    context.watch<LangProvider>();
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
                    if (!_isOwner && _myUserId != null)
                      PositionedDirectional(
                        top: 0,
                        end: 0,
                        child: SafeArea(
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.sm),
                            // Blocking the creator makes this post unreachable, so leave it.
                            child: PostSafetyMenu(postId: post.id, creatorId: post.creator.id, onBlocked: () => Navigator.of(context).pop()),
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
                          if (!_isOwner)
                            AnimatedBoostChip(
                              count: post.upvoteCount,
                              boosted: post.isUpvotedByMe,
                              onToggle: _toggleBoost,
                              boostedLabel: t(context, 'Raised', 'مُعزَّز'),
                              unboostedLabel: t(context, 'Raise', 'تعزيز'),
                              activeColor: AppColors.primary,
                              inactiveColor: AppColors.textMuted,
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              iconSize: 13,
                              fontSize: 12,
                            ),
                          Material(
                            color: Colors.transparent,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(AppRadius.chip),
                              onTap: () => showModalBottomSheet(
                                context: context,
                                isScrollControlled: true,
                                backgroundColor: Colors.transparent,
                                builder: (_) => CommentsSheet(postId: post.id, isPostOwner: _isOwner, allowImages: false),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.mode_comment_outlined, size: 18, color: AppColors.textSecondary),
                                    const SizedBox(width: 4),
                                    Text('${post.commentCount}', style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                                  ],
                                ),
                              ),
                            ),
                          ),
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
                          _InfoChip(icon: Icons.pets, label: _speciesLabel(context, ext.species)),
                          _InfoChip(icon: Icons.badge_outlined, label: ext.breed),
                          _InfoChip(icon: Icons.male, label: _genderLabel(context, ext.gender)),
                          _InfoChip(icon: Icons.cake_outlined, label: _ageLabel(context, ext.ageValue, ext.ageUnit)),
                          _InfoChip(icon: Icons.location_on_outlined, label: location),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: [
                          if (ext.isPurebred) _InfoChip(icon: Icons.verified_outlined, label: t(context, 'Purebred', 'أصيل')),
                          if (ext.hasPedigreeCertificate) _InfoChip(icon: Icons.description_outlined, label: t(context, 'Pedigree certificate', 'شهادة نسب')),
                          if (ext.vaccinated) _InfoChip(icon: Icons.vaccines_outlined, label: t(context, 'Vaccinated', 'مُطعّم')),
                          if (ext.dewormed) _InfoChip(icon: Icons.check_circle_outline, label: t(context, 'Dewormed', 'مُطهّر من الديدان')),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(t(context, 'About', 'نبذة'), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: AppSpacing.xs),
                      Text(post.description, style: Theme.of(context).textTheme.bodyMedium),
                      if (ext.termsSummary != null && ext.termsSummary!.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.md),
                        Text(t(context, 'Terms', 'الشروط'), style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(ext.termsSummary!, style: Theme.of(context).textTheme.bodyMedium),
                      ],
                      if (ext.matingConditions != null && ext.matingConditions!.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.md),
                        Text(t(context, 'Mating conditions', 'شروط التزاوج'), style: Theme.of(context).textTheme.headlineSmall),
                        const SizedBox(height: AppSpacing.xs),
                        Text(ext.matingConditions!, style: Theme.of(context).textTheme.bodyMedium),
                      ],
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
      bottomNavigationBar: _isOwner
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: OwnerPostActions(
                  postId: post.id,
                  close: OwnerCloseAction.mating,
                  isClosed: post.status != 'ACTIVE',
                  onClosed: (status) => setState(() => _post = _post!.copyWith(status: status)),
                  onDeleted: () => Navigator.of(context).pop(),
                ),
              ),
            )
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: switch (_myContactRequest?.status) {
                      'APPROVED' => _contactOwner,
                      null => _acceptsNewRequests ? _contactOwner : null,
                      _ => null,
                    },
                    child: Text(_contactButtonLabel(context)),
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
