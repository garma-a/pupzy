enum ContactRequestStatus { pending, approved, rejected }

class ContactRequestItem {
  final String id;
  final String requesterName;
  final String petName;
  final String petPhotoUrl;
  final String message;
  final DateTime timestamp;
  final bool isRead;
  final ContactRequestStatus status;

  const ContactRequestItem({
    required this.id,
    required this.requesterName,
    required this.petName,
    required this.petPhotoUrl,
    required this.message,
    required this.timestamp,
    this.isRead = false,
    this.status = ContactRequestStatus.pending,
  });

  ContactRequestItem copyWith({ContactRequestStatus? status, bool? isRead}) {
    return ContactRequestItem(
      id: id,
      requesterName: requesterName,
      petName: petName,
      petPhotoUrl: petPhotoUrl,
      message: message,
      timestamp: timestamp,
      isRead: isRead ?? this.isRead,
      status: status ?? this.status,
    );
  }
}
