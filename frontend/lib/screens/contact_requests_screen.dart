import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/contact_request.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/skeleton_loader.dart';

/// Contact requests I've SENT — tracks their approve/reject status.
///
/// There's no aggregate "requests received across all my posts" query on
/// the backend (only `postContactRequests(postId)`, scoped to one post),
/// so managing requests received on a listing happens on that listing's
/// own detail screen instead (see ContactRequestsOwnerSection).
class ContactRequestsScreen extends StatefulWidget {
  const ContactRequestsScreen({super.key});

  @override
  State<ContactRequestsScreen> createState() => _ContactRequestsScreenState();
}

class _ContactRequestsScreenState extends State<ContactRequestsScreen> {
  bool _loading = true;
  String? _errorMessage;
  List<ContactRequest> _requests = [];

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
    final (requests, error) = await graphql.fetchMyContactRequests(first: 50);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _requests = requests;
      _errorMessage = error;
    });
  }

  String _timeAgoFull(BuildContext context, DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return t(context, 'just now', 'الآن');
    if (diff.inMinutes < 60) return t(context, '${diff.inMinutes} min ago', 'قبل ${diff.inMinutes} دقيقة');
    if (diff.inHours < 24) return t(context, '${diff.inHours} hr ago', 'قبل ${diff.inHours} ساعة');
    if (diff.inDays < 7) return t(context, '${diff.inDays} d ago', 'قبل ${diff.inDays} يوم');
    return t(context, '${(diff.inDays / 7).floor()} w ago', 'قبل ${(diff.inDays / 7).floor()} أسبوع');
  }

  @override
  Widget build(BuildContext context) {
    final pending = _requests.where((r) => r.status == 'PENDING').toList();
    final resolved = _requests.where((r) => r.status != 'PENDING').toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 0),
              child: Row(
                children: [
                  Semantics(
                    button: true,
                    label: t(context, 'Back', 'رجوع'),
                    child: GestureDetector(
                      onTap: () => Navigator.of(context).pop(),
                      child: Container(
                        width: 40,
                        height: 40,
                        decoration: const BoxDecoration(color: AppColors.surface, shape: BoxShape.circle),
                        child: const Icon(Icons.chevron_left, color: AppColors.textPrimary),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t(context, 'My Contact Requests', 'طلبات التواصل الخاصة بي'), style: Theme.of(context).textTheme.headlineLarge),
                  const SizedBox(height: 2),
                  Text(
                    pending.isEmpty
                        ? t(context, 'No pending requests', 'لا توجد طلبات معلقة')
                        : t(context, '${pending.length} awaiting response', '${pending.length} بانتظار الرد'),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Expanded(
              child: _loading
                  ? ListView(
                      children: const [ListRowSkeleton(), ListRowSkeleton(), ListRowSkeleton(), ListRowSkeleton()],
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
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                          children: [
                            if (pending.isNotEmpty) ...[
                              Text(
                                t(context, 'AWAITING RESPONSE', 'بانتظار الرد'),
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5),
                              ),
                              const SizedBox(height: AppSpacing.sm),
                              ...pending.map((r) => Padding(
                                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                                    child: _RequestCard(item: r, timeLabel: _timeAgoFull(context, r.createdAt)),
                                  )),
                            ],
                            if (resolved.isNotEmpty) ...[
                              const SizedBox(height: AppSpacing.md),
                              Text(
                                t(context, 'RESOLVED', 'تم الرد'),
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5),
                              ),
                              const SizedBox(height: AppSpacing.sm),
                              ...resolved.map((r) => Padding(
                                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                                    child: _ResolvedCard(item: r),
                                  )),
                            ],
                            if (pending.isEmpty && resolved.isEmpty)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                                child: Center(
                                  child: Column(
                                    children: [
                                      const Icon(Icons.mail_outline, size: 44, color: AppColors.textMuted),
                                      const SizedBox(height: AppSpacing.sm),
                                      Text(
                                        t(context, "You haven't sent any contact requests yet", 'لم ترسل أي طلبات تواصل بعد'),
                                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                      ),
                                    ],
                                  ),
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

class _RequestCard extends StatelessWidget {
  final ContactRequest item;
  final String timeLabel;

  const _RequestCard({required this.item, required this.timeLabel});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 3))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.hourglass_empty, size: 18, color: AppColors.textMuted),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  '${t(context, 'Sent', 'أُرسل')} $timeLabel',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(color: AppColors.surfaceWarm, borderRadius: BorderRadius.circular(AppRadius.card)),
            child: Text('"${item.message}"', style: Theme.of(context).textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}

class _ResolvedCard extends StatelessWidget {
  final ContactRequest item;
  const _ResolvedCard({required this.item});

  Future<void> _openWhatsApp(BuildContext context) async {
    final link = item.whatsappLink;
    if (link == null) return;
    final opened = await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final approved = item.status == 'APPROVED';
    final canOpen = approved && item.whatsappLink != null;
    final statusColor = approved ? AppColors.sectionLineGreen : AppColors.critical;
    final statusLabel = approved
        ? t(context, 'Approved · WhatsApp shared', 'تمت الموافقة · تمت مشاركة واتساب')
        : t(context, 'Declined', 'مرفوض');

    return Opacity(
      opacity: 0.7,
      child: GestureDetector(
        onTap: canOpen ? () => _openWhatsApp(context) : null,
        child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text('"${item.message}"', style: Theme.of(context).textTheme.bodyMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
            const SizedBox(width: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppRadius.chip),
              ),
              child: Text(
                statusLabel,
                style: TextStyle(color: statusColor, fontWeight: FontWeight.w600, fontSize: 11),
              ),
            ),
            if (canOpen) ...[
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right, size: 18, color: AppColors.textMuted),
            ],
          ],
        ),
        ),
      ),
    );
  }
}
