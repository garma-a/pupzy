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
import '../widgets/animated_boost_chip.dart';
import '../widgets/animated_favorite_icon.dart';
import '../widgets/comments_sheet.dart';
import '../widgets/contact_request_sheet.dart';
import '../widgets/contact_requests_owner_section.dart';
import '../widgets/image_with_fallback.dart';
import '../widgets/nearby_vets_section.dart';
import '../widgets/owner_post_actions.dart';
import '../widgets/pet_carousel.dart';
import '../widgets/safety_actions.dart';
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
  String? _myUserId;
  ContactRequest? _myContactRequest;
  bool _openingWhatsApp = false;

  bool get _isOwner => _myUserId != null && _post != null && _post!.creator.id == _myUserId;

  /// RESCUE posts are anonymous call-outs: the reporter is a passer-by who
  /// photographed an animal in distress, not someone waiting to be messaged.
  /// Only LOST/FOUND reports route through the contact handshake.
  bool get _usesContactFlow => _post?.postType != 'RESCUE';

  void _openComments() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CommentsSheet(postId: _post!.id, isPostOwner: _isOwner),
    );
  }

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
    // RESCUE has no contact handshake, so there's nothing to look up for it.
    if (_myUserId != post.creator.id && post.postType != 'RESCUE') {
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
    if (existing.status != 'APPROVED' || _openingWhatsApp) return;
    // `myContactRequests` never populates `whatsappLink` — the backend only
    // computes it inside approveContactRequest's response (which goes to the
    // owner). The requester fetches it on demand with getWhatsAppLink.
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
    // Own pushed route — see account_suspended_screen.dart's comment for
    // why this direct dependency is needed for immediate language updates.
    context.watch<LangProvider>();
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
                      if (_lostExt != null) ..._identificationDetails(context, _lostExt!),
                      if (post.status == 'ACTIVE') ...[
                        const SizedBox(height: AppSpacing.lg),
                        _communityEvidenceCard(context),
                      ],
                      const SizedBox(height: AppSpacing.lg),
                      Row(
                        children: [
                          // Wraps onto a second line on narrow phones or with a large
                          // accessibility font instead of pushing the comment and save
                          // buttons off-screen (overflowed 37 px at 360 dp, 130 % text).
                          Expanded(
                            child: Wrap(
                              spacing: AppSpacing.sm,
                              runSpacing: AppSpacing.sm,
                              children: [
                          if (_isOwner)
                            Tooltip(
                              message: t(context, "You can't raise your own post", 'لا يمكنك تعزيز منشورك الخاص'),
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
                                    const Icon(Icons.arrow_upward, size: 15, color: AppColors.textMuted),
                                    const SizedBox(width: 5),
                                    Text(
                                      '${post.upvoteCount}  ${t(context, 'Raise', 'تعزيز')}',
                                      style: const TextStyle(fontSize: 13, color: AppColors.textMuted, fontWeight: FontWeight.w500),
                                    ),
                                  ],
                                ),
                              ),
                            )
                          else
                            AnimatedBoostChip(
                              count: post.upvoteCount,
                              boosted: post.isUpvotedByMe,
                              onToggle: _toggleBoost,
                              boostedLabel: t(context, 'Raised', 'مُعزَّز'),
                              unboostedLabel: t(context, 'Raise', 'تعزيز'),
                              activeColor: AppColors.primary,
                              inactiveColor: AppColors.textMuted,
                            ),
                          if (post.latitude != null && post.longitude != null)
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
                            ),
                          ),
                          Material(
                            color: Colors.transparent,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(AppRadius.chip),
                              onTap: _openComments,
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
          child: _isOwner
              ? OwnerPostActions(
                  postId: post.id,
                  close: post.postType == 'RESCUE'
                      ? OwnerCloseAction.rescue
                      : _lostExt?.reportType == 'FOUND_STRAY'
                          ? OwnerCloseAction.foundResolved
                          : OwnerCloseAction.lost,
                  alternateClose: _lostExt?.reportType == 'FOUND_STRAY' ? OwnerCloseAction.foundReunited : null,
                  isClosed: post.status != 'ACTIVE',
                  currentStatus: post.status,
                  onClosed: (status) => setState(() => _post = _post!.copyWith(status: status)),
                  onDeleted: () => Navigator.of(context).pop(),
                )
              : _usesContactFlow
                  ? SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _myContactRequest?.status == 'PENDING' || _myContactRequest?.status == 'REJECTED' ? null : _contactRescue,
                        child: Text(_contactButtonLabel(context)),
                      ),
                    )
                  // A rescue call-out needs a responder to go to the animal,
                  // not to message the person who photographed it. Once they
                  // have, the comment thread is where the proof goes.
                  : Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: post.latitude != null && post.longitude != null ? _openDirections : null,
                            icon: const Icon(Icons.directions_outlined, size: 18),
                            label: Text(t(context, 'Get Directions', 'الاتجاهات')),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _openComments,
                            icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                            label: Text(t(context, 'Post Update', 'نشر تحديث')),
                          ),
                        ),
                      ],
                    ),
        ),
      ),
    );
  }

  /// Rescue and lost/found threads are the only two places the backend lets
  /// a comment carry photos — it calls them "community evidence" (comments
  /// contract §1). That is deliberately the proof mechanism here: nobody
  /// files a separate report, the thread itself shows what happened, and the
  /// reporter closes the post once a photo shows the animal is safe.
  Widget _communityEvidenceCard(BuildContext context) {
    final isRescue = _post?.postType == 'RESCUE';
    final (title, body) = _isOwner
        ? (
            t(context, 'Watch this thread', 'تابع هذه المحادثة'),
            isRescue
                ? t(
                    context,
                    'Whoever reaches the animal posts a photo here. When one shows it is safe, mark this post rescued.',
                    'من يصل إلى الحيوان ينشر صورة هنا. عندما تُظهر صورة أنه بأمان، علّم هذا المنشور كمُنقذ.',
                  )
                : t(
                    context,
                    'People who spot your pet can post a photo here. When you have them back, close this post.',
                    'يمكن لمن يرى حيوانك نشر صورة هنا. عند استعادته، أغلق هذا المنشور.',
                  ),
          )
        : (
            t(context, 'Helped out? Show it', 'ساعدت؟ أظهر ذلك'),
            isRescue
                ? t(
                    context,
                    'Add a photo in the comments after you reach the animal. That is how everyone here knows it was rescued.',
                    'أضف صورة في التعليقات بعد وصولك إلى الحيوان. بهذا يعرف الجميع أنه تم إنقاذه.',
                  )
                : t(
                    context,
                    'Seen this pet? Add a photo in the comments so the owner knows where to look.',
                    'رأيت هذا الحيوان؟ أضف صورة في التعليقات ليعرف المالك أين يبحث.',
                  ),
          );

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.card),
        onTap: _openComments,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surfaceWarm,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.photo_camera_outlined, size: 20, color: AppColors.primary),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      body,
                      style: const TextStyle(fontSize: 13, height: 1.35, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The identification details a lost/found report collects — markings,
  /// collar, dates, and (for a found stray) the animal's condition and
  /// whether the finder still has it. These are the fields someone scanning
  /// reports actually matches against.
  List<Widget> _identificationDetails(BuildContext context, LostPostExtension ext) {
    final rows = <(String, String)>[];

    final markings = ext.colorAndMarkings;
    if (markings != null && markings.trim().isNotEmpty) {
      rows.add((t(context, 'Color & markings', 'اللون والعلامات المميزة'), markings));
    }
    if (ext.hasCollarWithIdentificationTag != null) {
      rows.add((
        t(context, 'Collar with ID tag', 'طوق يحمل بطاقة تعريف'),
        ext.hasCollarWithIdentificationTag!
            ? t(context, 'Yes', 'نعم')
            : t(context, 'No', 'لا'),
      ));
    }
    if (ext.reportType == 'FOUND_STRAY') {
      if (ext.dateFound != null) {
        rows.add((t(context, 'Found on', 'تاريخ العثور عليه'), ext.dateFound!));
      }
      if (ext.currentCondition != null) {
        rows.add((t(context, 'Condition', 'الحالة'), _conditionLabel(context, ext.currentCondition!)));
      }
      if (ext.isCurrentlySafeWithReporter != null) {
        rows.add((
          t(context, 'Currently with the finder', 'حاليًا مع من عثر عليه'),
          ext.isCurrentlySafeWithReporter!
              ? t(context, 'Yes — safe', 'نعم — بأمان')
              : t(context, 'No longer with them', 'لم يعد معهم'),
        ));
      }
    } else if (ext.dateLastSeen != null) {
      rows.add((t(context, 'Last seen', 'آخر مشاهدة'), ext.dateLastSeen!));
    }

    if (rows.isEmpty) return const [];
    return [
      const SizedBox(height: AppSpacing.md),
      Text(t(context, 'Identification', 'التعرّف على الحيوان'), style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: AppSpacing.xs),
      ...rows.map(
        (row) => Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 150,
                child: Text(row.$1, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
              ),
              Expanded(child: Text(row.$2, style: Theme.of(context).textTheme.bodyMedium)),
            ],
          ),
        ),
      ),
    ];
  }

  String _conditionLabel(BuildContext context, String condition) {
    return switch (condition) {
      'HEALTHY' => t(context, 'Healthy', 'بصحة جيدة'),
      'INJURED' => t(context, 'Injured', 'مصاب'),
      _ => t(context, 'Not sure', 'غير متأكد'),
    };
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
