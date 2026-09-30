import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/adoption_application.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import '../widgets/load_more_footer.dart';
import '../widgets/skeleton_loader.dart';
import 'adoption_detail_screen.dart';

/// Adoption applications I've SENT — the counterpart to
/// ContactRequestsScreen. Without this, an applicant can only check whether
/// they were approved by navigating back to each individual post.
class MyAdoptionApplicationsScreen extends StatefulWidget {
  const MyAdoptionApplicationsScreen({super.key});

  @override
  State<MyAdoptionApplicationsScreen> createState() => _MyAdoptionApplicationsScreenState();
}

class _MyAdoptionApplicationsScreenState extends State<MyAdoptionApplicationsScreen> {
  bool _loading = true;
  String? _errorMessage;
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
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    final graphql = context.read<GraphQLService>();
    final page = await graphql.fetchMyAdoptionApplications();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _applications = page.items;
      _errorMessage = page.errorMessage;
      _endCursor = page.endCursor;
      _hasNextPage = page.hasNextPage;
      _loadMoreFailed = false;
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
    final page = await graphql.fetchMyAdoptionApplications(after: _endCursor);
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

  Future<void> _openPost(AdoptionApplication a) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => AdoptionDetailScreen(postId: a.targetPostId)),
    );
    if (mounted) _load();
  }

  /// Approved applicants fetch the owner's link on demand — it's never
  /// carried on the application itself.
  Future<void> _messageOwner(AdoptionApplication a) async {
    final graphql = context.read<GraphQLService>();
    final (link, error) = await graphql.getAdoptionWhatsAppLink(a.id);
    if (!mounted) return;
    if (link == null) {
      Fluttertoast.showToast(msg: error ?? t(context, "This content isn't available.", 'هذا المحتوى غير متاح.'));
      return;
    }
    final opened = await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  @override
  Widget build(BuildContext context) {
    // Own pushed route — see account_suspended_screen.dart's comment for
    // why this direct dependency is needed for immediate language updates.
    final lang = context.watch<LangProvider>().lang;
    final pending = _applications.where((a) => a.status == 'PENDING').toList();
    final resolved = _applications.where((a) => a.status != 'PENDING').toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, 'My Applications', 'طلباتي للتبني'), style: Theme.of(context).textTheme.headlineMedium),
      ),
      body: _loading
          ? ListView(
              children: const [ListRowSkeleton(), ListRowSkeleton(), ListRowSkeleton()],
            )
          : _errorMessage != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                        const SizedBox(height: AppSpacing.sm),
                        Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                        const SizedBox(height: AppSpacing.md),
                        OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                      ],
                    ),
                  ),
                )
              : _applications.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.assignment_outlined, size: 44, color: AppColors.textMuted),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            t(context, "You haven't applied to adopt yet", 'لم تتقدم بطلب تبنٍ بعد'),
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                          ),
                        ],
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xxl),
                      children: [
                        if (pending.isNotEmpty) ...[
                          Text(
                            t(context, 'AWAITING RESPONSE', 'بانتظار الرد'),
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          ...pending.map((a) => _ApplicationCard(
                                application: a,
                                timeLabel: timeAgo(a.createdAt, lang),
                                onOpenPost: () => _openPost(a),
                                onMessageOwner: null,
                              )),
                        ],
                        if (resolved.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.md),
                          Text(
                            t(context, 'ANSWERED', 'تم الرد'),
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          ...resolved.map((a) => _ApplicationCard(
                                application: a,
                                timeLabel: timeAgo(a.respondedAt ?? a.createdAt, lang),
                                onOpenPost: () => _openPost(a),
                                onMessageOwner: a.status == 'APPROVED' ? () => _messageOwner(a) : null,
                              )),
                        ],
                        LoadMoreFooter(
                          hasMore: _hasNextPage,
                          loading: _loadingMore,
                          failed: _loadMoreFailed,
                          autoLoad: true,
                          pagedBeyondFirst: _pagesLoaded > 1,
                          onLoadMore: _loadMore,
                        ),
                      ],
                    ),
    );
  }
}

class _ApplicationCard extends StatelessWidget {
  final AdoptionApplication application;
  final String timeLabel;
  final VoidCallback onOpenPost;
  final VoidCallback? onMessageOwner;

  const _ApplicationCard({
    required this.application,
    required this.timeLabel,
    required this.onOpenPost,
    required this.onMessageOwner,
  });

  (String, Color) _status(BuildContext context) {
    switch (application.status) {
      case 'APPROVED':
        return (t(context, 'Approved', 'تمت الموافقة'), AppColors.sectionLineGreen);
      case 'REJECTED':
        return (t(context, 'Declined', 'مرفوض'), AppColors.critical);
      default:
        return (t(context, 'Pending', 'قيد المراجعة'), AppColors.textMuted);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (statusLabel, statusColor) = _status(context);
    return GestureDetector(
      onTap: onOpenPost,
      child: Container(
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
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(AppRadius.chip),
                  ),
                  child: Text(statusLabel, style: TextStyle(color: statusColor, fontWeight: FontWeight.w700, fontSize: 11)),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    '$timeLabel ${t(context, 'ago', 'مضت')}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted),
                  ),
                ),
                const Icon(Icons.chevron_right, size: 18, color: AppColors.textMuted),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              '"${application.whyAdopt}"',
              style: Theme.of(context).textTheme.bodyMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            if (onMessageOwner != null) ...[
              const SizedBox(height: AppSpacing.sm),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: onMessageOwner,
                  icon: const Icon(Icons.chat, size: 16),
                  label: Text(t(context, 'Message Owner on WhatsApp', 'راسل المالك على واتساب')),
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.sectionLineGreen),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
