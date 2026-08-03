import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:provider/provider.dart';

import '../localization/lang_provider.dart';
import '../services/graphql_service.dart';
import '../theme/app_theme.dart';

/// Full adoption-questionnaire form for `submitAdoptionApplication` — the
/// structured flow that differentiates Pupzy's adoption section from plain
/// classifieds. Pops `true` on success.
class AdoptionApplicationSheet extends StatefulWidget {
  final String postId;
  const AdoptionApplicationSheet({super.key, required this.postId});

  @override
  State<AdoptionApplicationSheet> createState() => _AdoptionApplicationSheetState();
}

class _AdoptionApplicationSheetState extends State<AdoptionApplicationSheet> {
  static const List<(String, String, String)> _livingSituations = [
    ('APARTMENT', 'Apartment', 'شقة'),
    ('HOUSE_WITH_YARD', 'House with yard', 'منزل بحديقة'),
    ('FARM', 'Farm', 'مزرعة'),
    ('OTHER', 'Other', 'أخرى'),
  ];

  final _whyAdoptController = TextEditingController();
  final _experienceController = TextEditingController();
  final _hoursController = TextEditingController();

  String? _livingSituation;
  bool _hasOutdoorAccess = false;
  bool _hasOtherPetsAtHome = false;
  bool _hasChildrenAtHome = false;
  bool _consentHomeVisit = false;
  bool _canProvideVetReference = false;
  bool _submitting = false;

  @override
  void dispose() {
    _whyAdoptController.dispose();
    _experienceController.dispose();
    _hoursController.dispose();
    super.dispose();
  }

  bool get _canSubmit => _livingSituation != null && _whyAdoptController.text.trim().isNotEmpty && !_submitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() => _submitting = true);
    final graphql = context.read<GraphQLService>();
    final input = <String, dynamic>{
      'targetPostId': widget.postId,
      'livingSituation': _livingSituation,
      'hasOutdoorAccess': _hasOutdoorAccess,
      'hasOtherPetsAtHome': _hasOtherPetsAtHome,
      'hasChildrenAtHome': _hasChildrenAtHome,
      'whyAdopt': _whyAdoptController.text.trim(),
      'consentHomeVisit': _consentHomeVisit,
      'canProvideVetReference': _canProvideVetReference,
    };
    final hours = int.tryParse(_hoursController.text.trim());
    if (hours != null) input['hoursAtHomePerDay'] = hours;
    if (_experienceController.text.trim().isNotEmpty) {
      input['previousPetExperience'] = _experienceController.text.trim();
    }

    final (application, error) = await graphql.submitAdoptionApplication(input);
    if (!mounted) return;
    setState(() => _submitting = false);
    if (application == null) {
      Fluttertoast.showToast(msg: error ?? t(context, 'Could not submit application. Try again.', 'تعذر إرسال الطلب. حاول مرة أخرى.'));
      return;
    }
    Navigator.of(context).pop(true);
    Fluttertoast.showToast(msg: t(context, 'Application submitted!', 'تم إرسال الطلب!'));
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomPad),
      child: Container(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(t(context, 'Adoption application', 'طلب التبني'), style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(
                t(context, 'A few questions to help the owner get to know you.', 'بعض الأسئلة لمساعدة المالك على التعرف عليك.'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppSpacing.lg),

              Text(t(context, 'Living situation', 'الوضع السكني'), style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: _livingSituations.map((c) {
                  final selected = _livingSituation == c.$1;
                  return ChoiceChip(
                    label: Text(t(context, c.$2, c.$3)),
                    selected: selected,
                    onSelected: (_) => setState(() => _livingSituation = c.$1),
                  );
                }).toList(),
              ),
              const SizedBox(height: AppSpacing.md),

              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'Outdoor access at home', 'يتوفر وصول لمساحة خارجية')),
                value: _hasOutdoorAccess,
                onChanged: (v) => setState(() => _hasOutdoorAccess = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'Other pets at home', 'يوجد حيوانات أليفة أخرى')),
                value: _hasOtherPetsAtHome,
                onChanged: (v) => setState(() => _hasOtherPetsAtHome = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'Children at home', 'يوجد أطفال في المنزل')),
                value: _hasChildrenAtHome,
                onChanged: (v) => setState(() => _hasChildrenAtHome = v),
              ),
              const SizedBox(height: AppSpacing.sm),

              TextField(
                controller: _hoursController,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: t(context, 'Hours at home per day (optional)', 'ساعات التواجد بالمنزل يوميًا (اختياري)')),
              ),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _experienceController,
                maxLines: 2,
                decoration: InputDecoration(labelText: t(context, 'Previous pet experience (optional)', 'خبرة سابقة مع الحيوانات (اختياري)')),
              ),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _whyAdoptController,
                maxLines: 3,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(labelText: t(context, 'Why do you want to adopt? *', 'لماذا تريد التبني؟ *')),
              ),
              const SizedBox(height: AppSpacing.sm),

              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'I consent to a home visit', 'أوافق على زيارة منزلية')),
                value: _consentHomeVisit,
                onChanged: (v) => setState(() => _consentHomeVisit = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(t(context, 'I can provide a vet reference', 'يمكنني تقديم مرجع من طبيب بيطري')),
                value: _canProvideVetReference,
                onChanged: (v) => setState(() => _canProvideVetReference = v),
              ),
              const SizedBox(height: AppSpacing.md),

              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  onPressed: _canSubmit ? _submit : null,
                  child: _submitting
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(t(context, 'Submit Application', 'إرسال الطلب')),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
    );
  }
}
