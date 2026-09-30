import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/contact_request.dart';
import '../models/safety.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import 'load_more_footer.dart';
import 'safety_actions.dart';

/// Shows PENDING contact requests received on a post I own, with inline
/// Approve/Reject actions. Renders nothing while loading or if there are
/// no pending requests — this is a supplementary section, not a primary
/// loading state.
class ContactRequestsOwnerSection extends StatefulWidget {
  final String postId;
  const ContactRequestsOwnerSection({super.key, required this.postId});

  @override
  State<ContactRequestsOwnerSection> createState() => _ContactRequestsOwnerSectionState();
}

class _ContactRequestsOwnerSectionState extends State<ContactRequestsOwnerSection> {
  bool _loading = true;
  List<ContactRequest> _requests = [];
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
    final page = await graphql.fetchPostContactRequests(postId: widget.postId, status: 'PENDING');
    if (!mounted) return;
    setState(() {
      _loading = false;
      _requests = page.items;
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
    final page = await graphql.fetchPostContactRequests(postId: widget.postId, status: 'PENDING', after: _endCursor);
    if (!mounted) return;
    setState(() {
      _loadingMore = false;
      if (page.failed) {
        _loadMoreFailed = true;
        return;
      }
      final known = _requests.map((x) => x.id).toSet();
      _requests = [..._requests, ...page.items.where((x) => known.add(x.id))];
      _endCursor = page.endCursor;
      _hasNextPage = page.hasNextPage;
      _pagesLoaded++;
    });
  }

  /// Answering every loaded row mustn't hide rows still waiting on the next
  /// page: fetch it as soon as the loaded ones run out.
  void _refillIfEmptied() {
    if (_requests.isEmpty && _hasNextPage) _loadMore();
  }

  /// A Block atomically rejects every pending request between the pair
  /// server-side, so drop all of that requester's rows locally too.
  void _dropRequestsFrom(String userId) {
    setState(() => _requests = _requests.where((x) => x.requester?.id != userId).toList());
    _refillIfEmptied();
  }

  Future<void> _reportRequester(ContactRequest r) async {
    final requester = r.requester;
    if (requester == null) return;
    final blocked = await reportAccountFlow(
      context,
      userId: requester.id,
      sourceType: AccountReportSource.contactRequest,
      sourceId: r.id,
    );
    if (blocked && mounted) _dropRequestsFrom(requester.id);
  }

  Future<void> _blockRequester(ContactRequest r) async {
    final requester = r.requester;
    if (requester == null) return;
    final blocked = await blockAccountFlow(context, userId: requester.id);
    if (blocked && mounted) _dropRequestsFrom(requester.id);
  }

  Future<void> _respond(ContactRequest r, bool approve) async {
    final graphql = context.read<GraphQLService>();
    final (updated, error) = approve
        ? await graphql.approveContactRequest(r.id)
        : await graphql.rejectContactRequest(r.id);
    if (!mounted) return;
    if (updated == null) {
      Fluttertoast.showToast(
        msg: error ?? t(context, 'Could not update request. Try again.', 'تعذر تحديث الطلب. حاول مرة أخرى.'),
      );
      return;
    }
    setState(() => _requests = _requests.where((x) => x.id != r.id).toList());
    _refillIfEmptied();
    Fluttertoast.showToast(
      msg: approve
          ? t(context, 'Approved — WhatsApp shared', 'تمت الموافقة — تمت مشاركة واتساب')
          : t(context, 'Declined', 'تم الرفض'),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || (_requests.isEmpty && !_hasNextPage && !_loadingMore)) return const SizedBox.shrink();
    final lang = Localizations.localeOf(context).languageCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${t(context, 'Interested people', 'أشخاص مهتمون')} (${_requests.length}${_hasNextPage ? '+' : ''})',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: AppSpacing.sm),
        ..._requests.map((r) {
          final requester = r.requester;
          final name = requester == null
              ? t(context, 'Deleted user', 'مستخدم محذوف')
              : (lang == 'ar' ? requester.fullNameArabic : requester.fullName) ??
                    requester.fullName ??
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
                      backgroundImage: requester?.profilePictureUrl != null
                          ? NetworkImage(requester!.profilePictureUrl!)
                          : null,
                      child: requester?.profilePictureUrl == null
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
                    if (requester != null)
                      SafetyMenuButton(
                        compact: true,
                        onReportAccount: () => _reportRequester(r),
                        onBlock: () => _blockRequester(r),
                      ),
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
                  child: Text('"${r.message}"', style: Theme.of(context).textTheme.bodyMedium),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _respond(r, false),
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
                        onPressed: () => _respond(r, true),
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
