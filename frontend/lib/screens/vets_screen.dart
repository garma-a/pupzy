import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../models/vet_clinic.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nearby_vets_section.dart';
import '../widgets/skeleton_loader.dart';

/// Full "View all vets" screen — up to 15 clinics nearest to the viewer's
/// home city, reached from Home's "Vets near you" sheet.
class VetsScreen extends StatefulWidget {
  const VetsScreen({super.key});

  @override
  State<VetsScreen> createState() => _VetsScreenState();
}

class _VetsScreenState extends State<VetsScreen> {
  bool _loading = true;
  String? _errorMessage;
  List<VetClinic> _clinics = [];

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
    final me = await graphql.fetchMe();
    final cityId = me?['homeCityId'] as String?;
    if (!mounted) return;
    if (cityId == null) {
      setState(() {
        _loading = false;
        _errorMessage = t(context, 'Set your city in your profile to see nearby vets.', 'حدد مدينتك في ملفك الشخصي لرؤية الأطباء البيطريين القريبين.');
      });
      return;
    }
    final (clinics, error) = await graphql.fetchNearbyVetClinics(cityId: cityId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (error != null) {
        _errorMessage = error;
      } else {
        _clinics = clinics;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: Text(t(context, 'Vets near you', 'الأطباء البيطريون القريبون'), style: Theme.of(context).textTheme.headlineMedium),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          color: AppColors.primary,
          child: _loading
              ? ListView(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
                  children: const [
                    ListCardSkeleton(imageHeight: 60),
                    ListCardSkeleton(imageHeight: 60),
                    ListCardSkeleton(imageHeight: 60),
                  ],
                )
              : _errorMessage != null
                  ? ListView(
                      children: [
                        const SizedBox(height: 100),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                          child: Column(
                            children: [
                              const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textMuted),
                              const SizedBox(height: AppSpacing.sm),
                              Text(_errorMessage!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted), textAlign: TextAlign.center),
                              const SizedBox(height: AppSpacing.md),
                              OutlinedButton(onPressed: _load, child: Text(t(context, 'Retry', 'إعادة المحاولة'))),
                            ],
                          ),
                        ),
                      ],
                    )
                  : _clinics.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 100),
                            Center(
                              child: Column(
                                children: [
                                  const Icon(Icons.local_hospital_outlined, size: 48, color: AppColors.textMuted),
                                  const SizedBox(height: AppSpacing.md),
                                  Text(
                                    t(context, 'No vet clinics found near you', 'لا توجد عيادات بيطرية بالقرب منك'),
                                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, 100),
                          children: [NearbyVetsSection(clinics: _clinics)],
                        ),
        ),
      ),
    );
  }
}
