/// The published Terms version/URL plus the signed-in account's acceptance
/// state. `currentVersion`/`termsUrl` are null while the release owner
/// hasn't configured `TERMS_URL`/`TERMS_VERSION` on the backend — in that
/// state [acceptanceRequired] is always false and nothing is gated.
class TermsInfo {
  final String? currentVersion;
  final String? termsUrl;
  final String? acceptedVersion;
  final DateTime? acceptedAt;
  final bool acceptanceRequired;

  const TermsInfo({
    this.currentVersion,
    this.termsUrl,
    this.acceptedVersion,
    this.acceptedAt,
    required this.acceptanceRequired,
  });

  factory TermsInfo.fromJson(Map<String, dynamic> json) => TermsInfo(
        currentVersion: json['currentVersion'] as String?,
        termsUrl: json['termsUrl'] as String?,
        acceptedVersion: json['acceptedVersion'] as String?,
        acceptedAt: json['acceptedAt'] != null ? DateTime.parse(json['acceptedAt'] as String) : null,
        acceptanceRequired: json['acceptanceRequired'] as bool? ?? false,
      );
}
