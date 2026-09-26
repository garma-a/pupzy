import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../localization/lang_provider.dart';
import '../models/terms_info.dart';
import '../theme/app_theme.dart';
import '../utils/time_format.dart';
import 'graphql_service.dart';

/// Call before any of the 9 backend-protected operations (creating a Post,
/// a Comment/Reply, a Contact Request or an Adoption Application). Reads the
/// account's current Terms state and, only when the backend says
/// `acceptanceRequired`, blocks with an acceptance sheet before returning.
///
/// Fails open on a network/server error reading `terms` — a connectivity
/// hiccup here shouldn't itself block posting; the backend still enforces
/// the gate on the protected mutation itself if it's genuinely required.
/// While `TERMS_URL`/`TERMS_VERSION` are unset on the backend this always
/// returns true immediately (`acceptanceRequired` is always false).
Future<bool> ensureTermsAccepted(BuildContext context) async {
  final graphql = context.read<GraphQLService>();
  final terms = await graphql.fetchTerms();
  if (!context.mounted) return false;
  if (terms == null || !terms.acceptanceRequired || terms.currentVersion == null) {
    return true;
  }
  return presentTermsAcceptance(context, version: terms.currentVersion!, url: terms.termsUrl);
}

/// Shows [version] of the Terms for explicit acceptance. Returns true once
/// the account has accepted the current version. [changed] explains that
/// the Terms were updated while the user was working, so the prompt doesn't
/// come out of nowhere.
Future<bool> presentTermsAcceptance(
  BuildContext context, {
  required String version,
  String? url,
  bool changed = false,
}) async {
  final accepted = await showModalBottomSheet<bool>(
    context: context,
    isDismissible: false,
    enableDrag: false,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _TermsAcceptanceSheet(version: version, url: url, changed: changed),
  );
  return accepted == true;
}

/// Runs a protected operation (creating a Post, Comment, Reply, Contact
/// Request or Adoption Application) and recovers from the Terms changing
/// underneath it.
///
/// [ensureTermsAccepted] checks before the user submits, but a new version
/// can be published between that check and the request. When the backend
/// then rejects the operation with `TERMS_ACCEPTANCE_REQUIRED`, this shows
/// the version named in the error for explicit acceptance and, only once it
/// is accepted, runs the operation exactly once more. The caller's draft is
/// untouched either way; declining returns the original failed result.
Future<T> withTermsRecovery<T>(BuildContext context, Future<T> Function() operation) async {
  final graphql = context.read<GraphQLService>();
  graphql.takeTermsRequirement();
  final result = await operation();
  final requirement = graphql.takeTermsRequirement();
  if (requirement == null || !context.mounted) return result;
  final accepted = await presentTermsAcceptance(context, version: requirement.version, url: requirement.url, changed: true);
  if (!accepted || !context.mounted) return result;
  return operation();
}

/// Opens the "Terms & Privacy" settings sheet — the informational, non-
/// blocking counterpart to [ensureTermsAccepted]: shows what's published,
/// what (if anything) the account has accepted and when, and lets the user
/// read or accept the current version on their own initiative rather than
/// only when a protected action forces it.
void showTermsInfoSheet(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _TermsInfoSheet(),
  );
}

class _TermsInfoSheet extends StatefulWidget {
  const _TermsInfoSheet();

  @override
  State<_TermsInfoSheet> createState() => _TermsInfoSheetState();
}

class _TermsInfoSheetState extends State<_TermsInfoSheet> {
  bool _loading = true;
  TermsInfo? _terms;
  bool _accepting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final terms = await context.read<GraphQLService>().fetchTerms();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _terms = terms;
    });
  }

  Future<void> _openTerms() async {
    final url = _terms?.termsUrl;
    if (url == null) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  Future<void> _accept() async {
    final version = _terms?.currentVersion;
    if (version == null || _accepting) return;
    setState(() => _accepting = true);
    final graphql = context.read<GraphQLService>();
    final (info, errorCode, errorMessage) = await graphql.acceptTerms(version);
    if (!mounted) return;
    if (errorCode == 'TERMS_VERSION_MISMATCH') {
      // A newer version was published while this sheet was open: show it
      // instead, for the user to read and accept.
      graphql.takeTermsRequirement();
      final fresh = await graphql.fetchTerms();
      if (!mounted) return;
      setState(() {
        _accepting = false;
        if (fresh != null) _terms = fresh;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_termsChangedCopy(context))),
      );
      return;
    }
    setState(() {
      _accepting = false;
      if (info != null) _terms = info;
    });
    if (info == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMessage ?? t(context, 'Could not record acceptance. Try again.', 'تعذر تسجيل الموافقة. حاول مرة أخرى.'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final lang = context.watch<LangProvider>().lang;
    final terms = _terms;
    return Container(
      padding: EdgeInsets.only(
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        top: AppSpacing.lg,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
      ),
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: AppSpacing.lg),
          Text(t(context, 'Terms & Privacy', 'الشروط والخصوصية'), style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: AppSpacing.md),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
            )
          else if (terms == null)
            Text(
              t(context, 'Could not load your Terms status right now.', 'تعذر تحميل حالة الشروط الآن.'),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
            )
          else if (terms.currentVersion == null)
            Text(
              t(context, 'No Terms have been published yet.', 'لم يتم نشر الشروط بعد.'),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textMuted),
            )
          else ...[
            Text(
              terms.acceptedVersion == terms.currentVersion && terms.acceptedAt != null
                  ? t(context, 'You accepted the current Terms', 'لقد وافقت على الشروط الحالية')
                  : terms.acceptedVersion != null
                      ? t(context, "You accepted an earlier version — please review the current one", 'لقد وافقت على نسخة سابقة — يرجى مراجعة النسخة الحالية')
                      : t(context, "You haven't accepted the current Terms yet", 'لم توافق على الشروط الحالية بعد'),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if (terms.acceptedVersion == terms.currentVersion && terms.acceptedAt != null) ...[
              const SizedBox(height: 4),
              Text(
                '${t(context, 'Accepted', 'تمت الموافقة')} ${timeAgo(terms.acceptedAt!, lang)} ${t(context, 'ago', 'مضت')}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted),
              ),
            ],
            if (terms.termsUrl != null) ...[
              const SizedBox(height: AppSpacing.sm),
              TextButton(onPressed: _openTerms, child: Text(t(context, 'Read the Terms', 'قراءة الشروط'))),
            ],
            if (terms.acceptanceRequired) ...[
              const SizedBox(height: AppSpacing.md),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _accepting ? null : _accept,
                  child: _accepting
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(t(context, 'Accept current Terms', 'الموافقة على الشروط الحالية')),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _TermsAcceptanceSheet extends StatefulWidget {
  final String version;
  final String? url;
  final bool changed;
  const _TermsAcceptanceSheet({required this.version, required this.url, this.changed = false});

  @override
  State<_TermsAcceptanceSheet> createState() => _TermsAcceptanceSheetState();
}

class _TermsAcceptanceSheetState extends State<_TermsAcceptanceSheet> {
  bool _accepting = false;

  /// The version shown and submitted. Starts as the one the sheet opened
  /// with and moves to a newer one if the Terms change while it is open.
  late String _version = widget.version;
  late String? _url = widget.url;
  late bool _changed = widget.changed;

  Future<void> _openTerms() async {
    final url = _url;
    if (url == null) return;
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  Future<void> _accept() async {
    setState(() => _accepting = true);
    final graphql = context.read<GraphQLService>();
    final (info, errorCode, errorMessage) = await graphql.acceptTerms(_version);
    if (!mounted) return;
    if (errorCode == 'TERMS_VERSION_MISMATCH') {
      // Never accept the newer version on the user's behalf: show it and
      // let them accept it explicitly.
      final requirement = graphql.takeTermsRequirement();
      final fresh = requirement == null ? await graphql.fetchTerms() : null;
      if (!mounted) return;
      final nextVersion = requirement?.version ?? fresh?.currentVersion;
      if (nextVersion == null || fresh?.acceptanceRequired == false) {
        // Nothing left to accept (Terms withdrawn, or already accepted).
        Navigator.of(context).pop(true);
        return;
      }
      setState(() {
        _accepting = false;
        _version = nextVersion;
        _url = requirement?.url ?? fresh?.termsUrl ?? _url;
        _changed = true;
      });
      return;
    }
    setState(() => _accepting = false);
    if (info != null && !info.acceptanceRequired) {
      Navigator.of(context).pop(true);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMessage ?? t(context, 'Could not record acceptance. Try again.', 'تعذر تسجيل الموافقة. حاول مرة أخرى.'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        top: AppSpacing.lg,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
      ),
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: AppSpacing.lg),
          Text(t(context, 'Updated Terms', 'شروط محدّثة'), style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: AppSpacing.sm),
          Text(
            _changed
                ? _termsChangedCopy(context)
                : t(
                    context,
                    'Please review and accept the current Pupzy Terms before continuing.',
                    'يرجى مراجعة شروط بابزي الحالية والموافقة عليها قبل المتابعة.',
                  ),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          if (_url != null) ...[
            const SizedBox(height: AppSpacing.sm),
            TextButton(onPressed: _openTerms, child: Text(t(context, 'Read the Terms', 'قراءة الشروط'))),
          ],
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _accepting ? null : () => Navigator.of(context).pop(false),
                  child: Text(t(context, 'Not now', 'ليس الآن')),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: ElevatedButton(
                  onPressed: _accepting ? null : _accept,
                  child: _accepting
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(t(context, 'Accept', 'أوافق')),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String _termsChangedCopy(BuildContext context) => t(
      context,
      "Pupzy's Terms were just updated. Please review the new version and accept it to continue — your draft is kept.",
      'تم تحديث شروط بابزي للتو. يرجى مراجعة النسخة الجديدة والموافقة عليها للمتابعة — تم الاحتفاظ بمسودتك.',
    );
