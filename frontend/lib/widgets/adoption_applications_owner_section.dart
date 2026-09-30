import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/adoption_application.dart';
import '../models/safety.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'load_more_footer.dart';
import 'safety_actions.dart';

/// Shows PENDING adoption applications received on a post I own, with
/// inline Approve/Reject actions. Renders nothing while loading or empty.
class AdoptionApplicationsOwnerSection extends StatefulWidget {
  final String postId;
  const AdoptionApplicationsOwnerSection({super.key, required this.postId});

  @override
  State<AdoptionApplicationsOwnerSection> createState() => _AdoptionApplicationsOwnerSectionState();
}

class _AdoptionApplicationsOwnerSectionState extends State<AdoptionApplicationsOwnerSection> {
  bool _loading = true;
  List<AdoptionApplication> _applications = [];
  String? _endCursor;
  bool _hasNextPage = false;
  bool _loadingMore = false;
  bool _loadMoreFailed = false;
  int _pagesLoaded = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final graphql = context.read<GraphQLService>();
    final page = await graphql.fetchPostAdoptionApplications(postId: widget.postId, status: 'PENDING');
    if (!mounted) return;
    setState(() {
      _loading = false;
      _applications = page.items;
      _endCursor = page.endCursor;
      _hasNextPage = page.hasNextPage;
      _pagesLoaded = 1;
    });
  }

  /// Loads the next page, skipping anything already shown (rows can move
  /// between pages when their status changes).
  Future<void> _loadMore() async {
    if (_loadingMore || !_hasNextPage) return;
    setState(() {
      _loadingMore = true;
      _loadMoreFailed = false;
    });
    final graphql = context.read<GraphQLService>();
    final page = await graphql.fetchPostAdoptionApplications(
      postId: widget.postId,
      status: 'PENDING',
      after: _endCursor,
    );
    if (!mounted) return;
    setState(() {
      _loadingMore = false;
      if (page.failed) {
        _loadMoreFailed = true;
        return;
      }
      final known = _applications.map((x) => x.id).toSet();
      _applications = [..._applications, ...page.items.where((x) => known.add(x.id))];
      _endCursor = page.endCursor;
      _hasNextPage = page.hasNextPage;
      _pagesLoaded++;
    });
  }

  /// Answering every loaded row mustn't hide rows still waiting on the next
  /// page: fetch it as soon as the loaded ones run out.
  void _refillIfEmptied() {
    if (_applications.isEmpty && _hasNextPage) _loadMore();
  }

  /// A Block atomically rejects every pending application between the pair
  /// server-side, so drop all of that applicant's rows locally too.
  void _dropApplicationsFrom(String userId) {
    setState(() => _applications = _applications.where((x) => x.applicant?.id != userId).toList());
    _refillIfEmptied();
  }

  Future<void> _reportApplicant(AdoptionApplication a) async {
    final applicant = a.applicant;
    if (applicant == null) return;
    final blocked = await reportAccountFlow(
      context,
      userId: applicant.id,
      sourceType: AccountReportSource.adoptionApplication,
      sourceId: a.id,
    );
    if (blocked && mounted) _dropApplicationsFrom(applicant.id);
  }

  Future<void> _blockApplicant(AdoptionApplication a) async {
    final applicant = a.applicant;
    if (applicant == null) return;
    final blocked = await blockAccountFlow(context, userId: applicant.id);
    if (blocked && mounted) _dropApplicationsFrom(applicant.id);
  }

  Future<void> _respond(AdoptionApplication a, bool approve) async {
    final graphql = context.read<GraphQLService>();
    final (updated, error) = approve
        ? await graphql.approveAdoptionApplication(a.id)
        : await graphql.rejectAdoptionApplication(a.id);
    if (!mounted) return;
    if (updated == null) {
      Fluttertoast.showToast(
        msg: error ?? t(context, 'Could not update application. Try again.', 'تعذر تحديث الطلب. حاول مرة أخرى.'),
      );
      return;
    }
    setState(() => _applications = _applications.where((x) => x.id != a.id).toList());
    _refillIfEmptied();
    Fluttertoast.showToast(msg: approve ? t(context, 'Approved', 'تمت الموافقة') : t(context, 'Declined', 'تم الرفض'));
  }

  String _livingSituationLabel(BuildContext context, String value) {
    switch (value) {
      case 'APARTMENT':
        return t(context, 'Apartment', 'شقة');
      case 'HOUSE_WITH_YARD':
        return t(context, 'House with yard', 'منزل بحديقة');
      case 'FARM':
        return t(context, 'Farm', 'مزرعة');
      default:
        return t(context, 'Other', 'أخرى');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || (_applications.isEmpty && !_hasNextPage && !_loadingMore)) return const SizedBox.shrink();
    final lang = Localizations.localeOf(context).languageCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${t(context, 'Adoption applications', 'طلبات التبني')} (${_applications.length}${_hasNextPage ? '+' : ''})',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: AppSpacing.sm),
        ..._applications.map((a) {
          final applicant = a.applicant;
          final name = applicant == null
              ? t(context, 'Deleted user', 'مستخدم محذوف')
              : (lang == 'ar' ? applicant.fullNameArabic : applicant.fullName) ??
                    applicant.fullName ??
                    t(context, 'Someone', 'شخص ما');
          return Container(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.card),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 18,
                      backgroundImage: applicant?.profilePictureUrl != null
                          ? NetworkImage(applicant!.profilePictureUrl!)
                          : null,
                      child: applicant?.profilePictureUrl == null
                          ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?')
                          : null,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        name,
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    if (applicant != null)
                      SafetyMenuButton(
                        compact: true,
                        onReportAccount: () => _reportApplicant(a),
                        onBlock: () => _blockApplicant(a),
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.xs,
                  runSpacing: AppSpacing.xs,
                  children: [
                    _Tag(label: _livingSituationLabel(context, a.livingSituation)),
                    if (a.hasOutdoorAccess) _Tag(label: t(context, 'Outdoor access', 'مساحة خارجية')),
                    if (a.hasOtherPetsAtHome) _Tag(label: t(context, 'Has other pets', 'لديه حيوانات أخرى')),
                    if (a.hasChildrenAtHome) _Tag(label: t(context, 'Has children', 'لديه أطفال')),
                    if (a.consentHomeVisit) _Tag(label: t(context, 'Home visit OK', 'موافق على زيارة منزلية')),
                    if (a.canProvideVetReference) _Tag(label: t(context, 'Vet reference', 'مرجع بيطري')),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceWarm,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                  ),
                  child: Text('"${a.whyAdopt}"', style: Theme.of(context).textTheme.bodyMedium),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _respond(a, false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.critical,
                          side: const BorderSide(color: AppColors.critical),
                        ),
                        child: Text(t(context, 'Decline', 'رفض')),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => _respond(a, true),
                        style: ElevatedButton.styleFrom(backgroundColor: AppColors.sectionLineGreen),
                        child: Text(t(context, 'Accept', 'قبول')),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        }),
        LoadMoreFooter(
          hasMore: _hasNextPage,
          loading: _loadingMore,
          failed: _loadMoreFailed,
          pagedBeyondFirst: _pagesLoaded > 1,
          onLoadMore: _loadMore,
        ),
      ],
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  const _Tag({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(label, style: Theme.of(context).textTheme.bodySmall),
    );
  }
}
