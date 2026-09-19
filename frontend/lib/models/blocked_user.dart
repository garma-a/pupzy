/// One row of the Blocked Accounts list — the minimal display identity the
/// backend exposes for an account the viewer blocked, plus when they blocked
/// it. Deliberately carries nothing about Block direction or reason.
class BlockedUser {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;
  final bool isVerified;
  final DateTime blockedAt;

  const BlockedUser({
    required this.id,
    this.fullName,
    this.fullNameArabic,
    this.profilePictureUrl,
    required this.isVerified,
    required this.blockedAt,
  });

  /// Parses a `BlockedUserEdge`.
  factory BlockedUser.fromEdge(Map<String, dynamic> edge) {
    final node = edge['node'] as Map<String, dynamic>;
    return BlockedUser(
      id: node['id'] as String,
      fullName: node['fullName'] as String?,
      fullNameArabic: node['fullNameArabic'] as String?,
      profilePictureUrl: node['profilePictureUrl'] as String?,
      isVerified: node['isVerified'] as bool? ?? false,
      blockedAt: DateTime.parse(edge['blockedAt'] as String),
    );
  }

  /// Localized display name — prefers the Arabic name in Arabic, else the
  /// English one, falling back to the other; null until the account
  /// completed its profile (callers show their anonymous placeholder).
  String? displayName({required bool arabic}) {
    final primary = arabic ? fullNameArabic : fullName;
    final secondary = arabic ? fullName : fullNameArabic;
    final name = (primary != null && primary.trim().isNotEmpty) ? primary : secondary;
    return (name != null && name.trim().isNotEmpty) ? name : null;
  }
}
