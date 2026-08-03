class ContactRequestUser {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;

  const ContactRequestUser({required this.id, this.fullName, this.fullNameArabic, this.profilePictureUrl});

  factory ContactRequestUser.fromJson(Map<String, dynamic> json) => ContactRequestUser(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        fullNameArabic: json['fullNameArabic'] as String?,
        profilePictureUrl: json['profilePictureUrl'] as String?,
      );
}

/// A request to unlock WhatsApp contact for a RESCUE/LOST/ADOPTION post.
class ContactRequest {
  final String id;
  final String postId;
  final ContactRequestUser requester;
  final String message;
  final String status; // PENDING, APPROVED, REJECTED
  final String? whatsappLink;
  final DateTime? respondedAt;
  final DateTime createdAt;

  const ContactRequest({
    required this.id,
    required this.postId,
    required this.requester,
    required this.message,
    required this.status,
    this.whatsappLink,
    this.respondedAt,
    required this.createdAt,
  });

  factory ContactRequest.fromJson(Map<String, dynamic> json) => ContactRequest(
        id: json['id'] as String,
        postId: json['postId'] as String,
        requester: ContactRequestUser.fromJson(json['requester'] as Map<String, dynamic>),
        message: json['message'] as String,
        status: json['status'] as String,
        whatsappLink: json['whatsappLink'] as String?,
        respondedAt: json['respondedAt'] != null ? DateTime.parse(json['respondedAt'] as String) : null,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  ContactRequest copyWith({String? status, String? whatsappLink}) => ContactRequest(
        id: id,
        postId: postId,
        requester: requester,
        message: message,
        status: status ?? this.status,
        whatsappLink: whatsappLink ?? this.whatsappLink,
        respondedAt: respondedAt,
        createdAt: createdAt,
      );
}
