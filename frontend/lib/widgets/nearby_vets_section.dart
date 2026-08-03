import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/vet_clinic.dart';
import '../theme/app_theme.dart';

/// Real "nearby vets" list backed by `Post.nearestVetClinics` — shown on
/// RESCUE/LOST/ADOPTION detail screens. Renders nothing for PRODUCT posts,
/// which always return an empty list server-side.
class NearbyVetsSection extends StatelessWidget {
  final List<VetClinic> clinics;
  const NearbyVetsSection({super.key, required this.clinics});

  Future<void> _openMaps(BuildContext context, String url) async {
    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open Google Maps', 'تعذر فتح خرائط جوجل'));
    }
  }

  Future<void> _openWhatsApp(BuildContext context, String url) async {
    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      Fluttertoast.showToast(msg: t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب'));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (clinics.isEmpty) return const SizedBox.shrink();
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(t(context, 'Nearby Vets', 'الأطباء البيطريون القريبون'), style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: AppSpacing.sm),
        ...clinics.map((clinic) {
          final name = (isArabic ? clinic.nameArabic : clinic.nameEnglish) ?? clinic.nameEnglish ?? clinic.nameArabic ?? t(context, 'Vet clinic', 'عيادة بيطرية');
          return Container(
            margin: const EdgeInsets.only(bottom: AppSpacing.sm),
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.card),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.12), shape: BoxShape.circle),
                  child: const Icon(Icons.local_hospital_outlined, color: AppColors.primary, size: 18),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                      Text(
                        '${clinic.distanceKm.toStringAsFixed(1)} ${t(context, 'km away', 'كم')}${clinic.address != null ? ' · ${clinic.address}' : ''}',
                        style: Theme.of(context).textTheme.bodySmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                if (clinic.whatsappPhoneUrl != null)
                  IconButton(
                    onPressed: () => _openWhatsApp(context, clinic.whatsappPhoneUrl!),
                    icon: const Icon(Icons.chat, color: AppColors.sectionLineGreen, size: 20),
                    tooltip: t(context, 'WhatsApp', 'واتساب'),
                  ),
                IconButton(
                  onPressed: () => _openMaps(context, clinic.googleMapsUrl),
                  icon: const Icon(Icons.directions_outlined, color: AppColors.primary, size: 20),
                  tooltip: t(context, 'Directions', 'الاتجاهات'),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }
}
