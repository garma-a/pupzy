import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/contact_request.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final graphql = context.read<GraphQLService>();
    final (requests, _) = await graphql.fetchPostContactRequests(postId: widget.postId, status: 'PENDING');
    if (!mounted) return;
    setState(() {
      _loading = false;
      _requests = requests;
    });
  }

  Future<void> _respond(ContactRequest r, bool approve) async {
    final graphql = context.read<GraphQLService>();
    final (updated, error) = approve ? await graphql.approveContactRequest(r.id) : await graphql.rejectContactRequest(r.id);
    if (!mounted) return;
    if (updated == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update request. Try again.', 'تعذر تحديث الطلب. حاول مرة أخرى.'));
      return;
    }
    setState(() => _requests = _requests.where((x) => x.id != r.id).toList());
    Fluttertoast.showToast(msg: approve ? t(context, 'Approved — WhatsApp shared', 'تمت الموافقة — تمت مشاركة واتساب') : t(context, 'Declined', 'تم الرفض'));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _requests.isEmpty) return const SizedBox.shrink();
    final lang = Localizations.localeOf(context).languageCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${t(context, 'Interested people', 'أشخاص مهتمون')} (${_requests.length})',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: AppSpacing.sm),
        ..._requests.map((r) {
          final name = (lang == 'ar' ? r.requester.fullNameArabic : r.requester.fullName) ?? r.requester.fullName ?? t(context, 'Someone', 'شخص ما');
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
                      backgroundImage: r.requester.profilePictureUrl != null ? NetworkImage(r.requester.profilePictureUrl!) : null,
                      child: r.requester.profilePictureUrl == null ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?') : null,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(child: Text(name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700))),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(color: AppColors.surfaceWarm, borderRadius: BorderRadius.circular(AppRadius.card)),
                  child: Text('"${r.message}"', style: Theme.of(context).textTheme.bodyMedium),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _respond(r, false),
                        style: OutlinedButton.styleFrom(foregroundColor: AppColors.critical, side: const BorderSide(color: AppColors.critical)),
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
      ],
    );
  }
}
