import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/vet_clinic.dart';
import '../theme/app_theme.dart';
import '../utils/distance_label.dart';

/// A clinic's name in the shown language. Names may carry a place label
/// ("Pet Care Clinic (Damanhour)"), which is kept.
String vetClinicName(BuildContext context, VetClinic clinic) {
  final isArabic = Localizations.localeOf(context).languageCode == 'ar';
  return (isArabic ? clinic.nameArabic : clinic.nameEnglish) ??
      clinic.nameEnglish ??
      clinic.nameArabic ??
      t(context, 'Vet clinic', 'عيادة بيطرية');
}

/// How far the clinic is. An approximate clinic sits on its area's centre,
/// so a viewer in that area would read "0.0 km": they get "In your area"
/// instead, and farther approximate distances are marked "≈".
String vetClinicDistanceLabel(BuildContext context, VetClinic clinic) {
  final distance = formatDistanceKm(clinic.distanceKm);
  if (clinic.isApproximateLocation && clinic.distanceKm < 1) return t(context, 'In your area', 'في منطقتك');
  final label = '$distance ${t(context, 'km away', 'كم')}';
  return clinic.isApproximateLocation ? '≈ $label' : label;
}

/// The clinic's name (up to two lines) with a "24h" badge when it says it
/// is open around the clock.
class VetClinicName extends StatelessWidget {
  const VetClinicName({super.key, required this.clinic});

  final VetClinic clinic;

  @override
  Widget build(BuildContext context) {
    final name = Text(
      vetClinicName(context, clinic),
      style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
    if (!clinic.is24Hours) return name;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Flexible(child: name),
        const SizedBox(width: 6),
        Container(
          margin: const EdgeInsets.only(top: 2),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          decoration: BoxDecoration(
            color: AppColors.sectionLineGreen.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(AppRadius.chip),
          ),
          child: Text(
            t(context, '24h', '٢٤ ساعة'),
            style: const TextStyle(color: AppColors.sectionLineGreen, fontSize: 11, fontWeight: FontWeight.w800),
          ),
        ),
      ],
    );
  }
}

/// Real "nearby vets" list backed by `Post.nearestVetClinics` — shown on
/// RESCUE/LOST/ADOPTION detail screens and the Vets screen. Renders nothing
/// for PRODUCT posts, which always return an empty list server-side.
class NearbyVetsSection extends StatelessWidget {
  final List<VetClinic> clinics;
  const NearbyVetsSection({super.key, required this.clinics});

  Future<void> _open(BuildContext context, String url, String failure) async {
    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) Fluttertoast.showToast(msg: failure);
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
          final address = clinic.addressFor(isArabic);
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
                      VetClinicName(clinic: clinic),
                      Text(
                        '${vetClinicDistanceLabel(context, clinic)}${address != null ? ' · $address' : ''}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(fontFeatures: distanceFontFeatures),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (clinic.isApproximateLocation)
                        Text(
                          t(context, 'Approximate location', 'موقع تقريبي'),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted, fontSize: 11),
                        ),
                    ],
                  ),
                ),
                if (clinic.whatsappPhoneUrl != null)
                  IconButton(
                    onPressed: () => _open(context, clinic.whatsappPhoneUrl!, t(context, 'Could not open WhatsApp', 'تعذر فتح واتساب')),
                    icon: const Icon(Icons.chat, color: AppColors.sectionLineGreen, size: 20),
                    tooltip: t(context, 'WhatsApp', 'واتساب'),
                  ),
                if (clinic.facebookUrl != null)
                  IconButton(
                    onPressed: () => _open(context, clinic.facebookUrl!, t(context, 'Could not open Facebook', 'تعذر فتح فيسبوك')),
                    icon: const Icon(Icons.facebook, color: Color(0xFF1877F2), size: 20),
                    tooltip: t(context, 'Facebook', 'فيسبوك'),
                  ),
                // Always the server's link: for approximate clinics it is a
                // Maps search by name and address, which finds the clinic;
                // a pin from latitude/longitude would mark the area's centre.
                IconButton(
                  onPressed: () => _open(context, clinic.googleMapsUrl, t(context, 'Could not open Google Maps', 'تعذر فتح خرائط جوجل')),
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
