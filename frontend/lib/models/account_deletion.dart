/// Result of requesting or querying an account deletion
/// (`deleteMyAccount` / `accountDeletionProgress`).
class AccountDeletionPayload {
  final String status; // PENDING, COMPLETED, FAILED
  final String deletionId;
  final String? progressToken;
  final String message;
  final DateTime acceptedAt;
  final DateTime? completedAt;

  const AccountDeletionPayload({
    required this.status,
    required this.deletionId,
    this.progressToken,
    required this.message,
    required this.acceptedAt,
    this.completedAt,
  });

  factory AccountDeletionPayload.fromJson(Map<String, dynamic> json) => AccountDeletionPayload(
        status: json['status'] as String,
        deletionId: json['deletionId'] as String,
        progressToken: json['progressToken'] as String?,
        message: json['message'] as String,
        acceptedAt: DateTime.parse(json['acceptedAt'] as String),
        completedAt: json['completedAt'] != null ? DateTime.parse(json['completedAt'] as String) : null,
      );
}
