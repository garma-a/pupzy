import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/adoption_application.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final graphql = context.read<GraphQLService>();
    final (applications, _) = await graphql.fetchPostAdoptionApplications(postId: widget.postId, status: 'PENDING');
    if (!mounted) return;
    setState(() {
      _loading = false;
      _applications = applications;
    });
  }

  Future<void> _respond(AdoptionApplication a, bool approve) async {
    final graphql = context.read<GraphQLService>();
    final (updated, error) = approve ? await graphql.approveAdoptionApplication(a.id) : await graphql.rejectAdoptionApplication(a.id);
    if (!mounted) return;
    if (updated == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not update application. Try again.', 'تعذر تحديث الطلب. حاول مرة أخرى.'));
      return;
    }
    setState(() => _applications = _applications.where((x) => x.id != a.id).toList());
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
    if (_loading || _applications.isEmpty) return const SizedBox.shrink();
    final lang = Localizations.localeOf(context).languageCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${t(context, 'Adoption applications', 'طلبات التبني')} (${_applications.length})',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: AppSpacing.sm),
        ..._applications.map((a) {
          final name = (lang == 'ar' ? a.applicant.fullNameArabic : a.applicant.fullName) ?? a.applicant.fullName ?? t(context, 'Someone', 'شخص ما');
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
                      backgroundImage: a.applicant.profilePictureUrl != null ? NetworkImage(a.applicant.profilePictureUrl!) : null,
                      child: a.applicant.profilePictureUrl == null ? Text(name.isNotEmpty ? name[0].toUpperCase() : '?') : null,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(child: Text(name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700))),
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
                  decoration: BoxDecoration(color: AppColors.surfaceWarm, borderRadius: BorderRadius.circular(AppRadius.card)),
                  child: Text('"${a.whyAdopt}"', style: Theme.of(context).textTheme.bodyMedium),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _respond(a, false),
                        style: OutlinedButton.styleFrom(foregroundColor: AppColors.critical, side: const BorderSide(color: AppColors.critical)),
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
      decoration: BoxDecoration(color: AppColors.background, borderRadius: BorderRadius.circular(AppRadius.chip), border: Border.all(color: AppColors.border)),
      child: Text(label, style: Theme.of(context).textTheme.bodySmall),
    );
  }
}
