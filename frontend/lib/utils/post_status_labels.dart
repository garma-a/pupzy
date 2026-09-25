import 'package:flutter/material.dart';

import '../localization/lang_provider.dart';
import '../theme/app_theme.dart';

/// Short localized name of how a Post ended (or that it lapsed).
///
/// A RESCUE closed as `RESOLVED` reads "Rescued": immediate danger addressed
/// and appropriate care secured. `ANIMAL_DECEASED` is its own outcome and is
/// never worded or styled as a success. An unknown status reads "Closed"
/// rather than the raw API value, and is never assumed to be Rescued.
String postOutcomeLabel(BuildContext context, String status, {String? postType}) => switch (status) {
      'ACTIVE' => t(context, 'Active', 'نشط'),
      'RESOLVED' when postType == 'RESCUE' => t(context, 'Rescued', 'تم الإنقاذ'),
      'RESOLVED' => t(context, 'Resolved', 'تم الحل'),
      'ANIMAL_DECEASED' => t(context, 'Animal deceased', 'وفاة الحيوان'),
      'REUNITED' => t(context, 'Reunited', 'تم لمّ الشمل'),
      'ADOPTED' => t(context, 'Adopted', 'تم التبني'),
      'SOLD' => t(context, 'Sold', 'مباع'),
      'EXPIRED' => t(context, 'Expired', 'منتهي'),
      _ => t(context, 'Closed', 'مغلق'),
    };

/// Label for the contact button when the Post no longer accepts new contact
/// requests and the viewer has none: says why instead of inviting a request
/// the backend would reject.
String closedToNewRequestsLabel(BuildContext context, String status, {String? postType}) =>
    '${postOutcomeLabel(context, status, postType: postType)} — ${t(context, 'no new requests', 'لا تُقبل طلبات جديدة')}';

/// As [closedToNewRequestsLabel], for adoption applications.
String closedToNewApplicationsLabel(BuildContext context, String status) =>
    '${postOutcomeLabel(context, status)} — ${t(context, 'no new applications', 'لا تُقبل طلبات تبنٍّ جديدة')}';

/// A closed Post's outcome, shown on its detail screen so every viewer — not
/// only the owner — can see how it ended. Neutral styling throughout; only a
/// successful outcome gets a tick, never `ANIMAL_DECEASED`.
class PostOutcomeBanner extends StatelessWidget {
  const PostOutcomeBanner({super.key, required this.status, this.postType});

  final String status;
  final String? postType;

  static const _successful = {'RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD'};

  @override
  Widget build(BuildContext context) {
    final successful = _successful.contains(status);
    final label = postOutcomeLabel(context, status, postType: postType);
    final detail = switch (status) {
      'ANIMAL_DECEASED' => t(
          context,
          'This rescue was closed because the animal died.',
          'أُغلقت حالة الإنقاذ هذه بسبب وفاة الحيوان.',
        ),
      'RESOLVED' when postType == 'RESCUE' => t(
          context,
          'Immediate danger was addressed and appropriate care secured.',
          'زال الخطر المباشر وتم تأمين الرعاية المناسبة.',
        ),
      'EXPIRED' => t(context, 'This listing expired.', 'انتهت صلاحية هذا الإعلان.'),
      _ => t(context, 'This post is closed.', 'هذا المنشور مغلق.'),
    };
    return Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.surfaceWarm,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Icon(
              successful ? Icons.check_circle_outline : Icons.info_outline,
              size: 20,
              color: AppColors.textSecondary,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(label, style: Theme.of(context).textTheme.labelLarge),
                  Text(detail, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
