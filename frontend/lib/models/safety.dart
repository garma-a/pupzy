/// One selectable reason in a report sheet. [value] is the exact GraphQL enum
/// literal the backend expects (`ReportReason` for Post/Comment reports,
/// `AccountReportReason` for Account reports).
class ReportReasonOption {
  final String value;
  final String en;
  final String ar;
  const ReportReasonOption(this.value, this.en, this.ar);
}

/// Values of the shared content `ReportReason` enum, used by `reportPost` and
/// `reportComment`. Copy follows the backend integration contract §13.2.
const List<ReportReasonOption> contentReportReasons = [
  ReportReasonOption('UNRELATED_TO_ANIMALS', 'Unrelated to animals', 'غير متعلق بالحيوانات'),
  ReportReasonOption('SPAM', 'Spam', 'محتوى مزعج'),
  ReportReasonOption('INAPPROPRIATE_CONTENT', 'Inappropriate content', 'محتوى غير لائق'),
  ReportReasonOption('SCAM', 'Scam or fraud', 'احتيال أو نصب'),
  ReportReasonOption('DUPLICATE', 'Duplicate listing', 'منشور مكرر'),
  ReportReasonOption('OTHER', 'Other', 'أخرى'),
];

/// Values of the separate `AccountReportReason` enum, used by `reportUser`.
/// Content-only reasons (duplicate, unrelated) are deliberately absent. Copy
/// follows the backend integration contract §13.3.
const List<ReportReasonOption> accountReportReasons = [
  ReportReasonOption('HARASSMENT', 'Harassment or bullying', 'تحرش أو تنمر'),
  ReportReasonOption('SPAM', 'Spam', 'إزعاج أو محتوى مزعج'),
  ReportReasonOption('SCAM_OR_FRAUD', 'Scam or fraud', 'احتيال أو نصب'),
  ReportReasonOption('IMPERSONATION', 'Impersonation', 'انتحال شخصية'),
  ReportReasonOption('INAPPROPRIATE_CONDUCT', 'Inappropriate conduct', 'سلوك غير لائق'),
  ReportReasonOption('SAFETY_CONCERN', 'Safety concern', 'مخاوف تتعلق بالسلامة'),
  ReportReasonOption('OTHER', 'Other', 'أخرى'),
];

/// `AccountReportSourceType` — the evidence record a `reportUser` call can
/// point at. [value] is the GraphQL enum literal.
enum AccountReportSource {
  post('POST'),
  comment('COMMENT'),
  contactRequest('CONTACT_REQUEST'),
  adoptionApplication('ADOPTION_APPLICATION');

  final String value;
  const AccountReportSource(this.value);
}

/// Outcome of a report/block mutation, keeping the stable `extensions.code`
/// the backend contract defines (§8) alongside the human-readable message so
/// callers can branch on "already reported" / "rate limited" without parsing
/// message text.
class SafetyResult {
  final bool ok;
  final String? code;
  final String? message;
  const SafetyResult({required this.ok, this.code, this.message});

  static const success = SafetyResult(ok: true);

  bool get isAlreadyReported =>
      code == 'POST_ALREADY_REPORTED' || code == 'COMMENT_ALREADY_REPORTED' || code == 'ACCOUNT_ALREADY_REPORTED';
  bool get isRateLimited => code == 'RATE_LIMITED';
}
