import 'package:flutter/material.dart';

import '../data/mock_data.dart';
import '../localization/lang_provider.dart';
import '../models/contact_request_item.dart';
import '../theme/app_theme.dart';
import '../widgets/image_with_fallback.dart';

/// Contact request inbox for post owners.
///
/// There's no backend support for this yet — `ContactRequest` exists only
/// as a read type in the GraphQL schema, with no query to list them and no
/// mutation to approve/reject. This screen runs entirely on local mock
/// data (`MockData.contactRequests`) until that API exists.
class ContactRequestsScreen extends StatefulWidget {
  const ContactRequestsScreen({super.key});

  @override
  State<ContactRequestsScreen> createState() => _ContactRequestsScreenState();
}

class _ContactRequestsScreenState extends State<ContactRequestsScreen> {
  void _respond(ContactRequestItem item, ContactRequestStatus status) {
    final index = MockData.contactRequests.indexWhere((r) => r.id == item.id);
    if (index == -1) return;
    setState(() {
      MockData.contactRequests[index] = item.copyWith(status: status, isRead: true);
    });
  }

  String _timeAgoFull(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return t(context, 'just now', 'الآن');
    if (diff.inMinutes < 60) return t(context, '${diff.inMinutes} min ago', 'قبل ${diff.inMinutes} دقيقة');
    if (diff.inHours < 24) return t(context, '${diff.inHours} hr ago', 'قبل ${diff.inHours} ساعة');
    if (diff.inDays < 7) return t(context, '${diff.inDays} d ago', 'قبل ${diff.inDays} يوم');
    return t(context, '${(diff.inDays / 7).floor()} w ago', 'قبل ${(diff.inDays / 7).floor()} أسبوع');
  }

  @override
  Widget build(BuildContext context) {
    final pending = MockData.contactRequests.where((r) => r.status == ContactRequestStatus.pending).toList();
    final resolved = MockData.contactRequests.where((r) => r.status != ContactRequestStatus.pending).toList();

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
                  Text(t(context, 'Contact Requests', 'طلبات التواصل'), style: Theme.of(context).textTheme.headlineLarge),
                  const SizedBox(height: 2),
                  Text(
                    pending.isEmpty
                        ? t(context, 'No pending requests', 'لا توجد طلبات معلقة')
                        : t(context, '${pending.length} pending', '${pending.length} معلّق'),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxl),
                children: [
                  if (pending.isNotEmpty) ...[
                    Text(
                      t(context, 'AWAITING YOUR RESPONSE', 'بانتظار ردك'),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    ...pending.map((r) => Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.md),
                          child: _RequestCard(
                            item: r,
                            timeLabel: _timeAgoFull(r.timestamp),
                            onAccept: () => _respond(r, ContactRequestStatus.approved),
                            onDecline: () => _respond(r, ContactRequestStatus.rejected),
                          ),
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
                              t(context, 'No contact requests yet', 'لا توجد طلبات تواصل بعد'),
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
  final ContactRequestItem item;
  final String timeLabel;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  const _RequestCard({
    required this.item,
    required this.timeLabel,
    required this.onAccept,
    required this.onDecline,
  });

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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipOval(
                child: ImageWithFallback(url: item.petPhotoUrl, width: 44, height: 44),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.requesterName, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(
                      '${t(context, 'Asking about', 'يسأل عن')} ${item.petName}  ·  $timeLabel',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              if (!item.isRead)
                Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.only(top: 4),
                  decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
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
            child: Text(
              '"${item.message}"',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: onAccept,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.sectionLineGreen.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                    ),
                    child: Center(
                      child: Text(
                        'Accept  ·  قبول',
                        style: TextStyle(color: AppColors.sectionLineGreen, fontWeight: FontWeight.w700, fontSize: 14),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: GestureDetector(
                  onTap: onDecline,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.critical.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                    ),
                    child: Center(
                      child: Text(
                        'Decline  ·  رفض',
                        style: TextStyle(color: AppColors.critical, fontWeight: FontWeight.w700, fontSize: 14),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ResolvedCard extends StatelessWidget {
  final ContactRequestItem item;
  const _ResolvedCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final approved = item.status == ContactRequestStatus.approved;
    final statusColor = approved ? AppColors.sectionLineGreen : AppColors.critical;
    final statusLabel = approved
        ? t(context, 'Accepted  ·  Number shared', 'مقبول  ·  تمت مشاركة الرقم')
        : t(context, 'Declined', 'مرفوض');

    return Opacity(
      opacity: 0.7,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: Row(
          children: [
            ClipOval(
              child: ImageWithFallback(url: item.petPhotoUrl, width: 40, height: 40),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.requesterName, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                  Text(
                    '${t(context, 'About', 'بخصوص')} ${item.petName}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
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
          ],
        ),
      ),
    );
  }
}
