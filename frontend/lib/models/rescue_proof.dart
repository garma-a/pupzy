/// One selectable answer in the proof form. [value] is the exact GraphQL enum
/// literal the backend expects.
class ProofChoice {
  final String value;
  final String en;
  final String ar;
  const ProofChoice(this.value, this.en, this.ar);
}

/// `AnimalConditionNow` — how the animal is doing at the moment of the proof.
const List<ProofChoice> proofConditions = [
  ProofChoice('HEALTHY', 'Healthy and safe', 'بصحة جيدة وآمن'),
  ProofChoice('INJURED_OR_SICK', 'Injured or sick', 'مصاب أو مريض'),
  ProofChoice('NEEDS_URGENT_CARE', 'Needs urgent care', 'يحتاج رعاية عاجلة'),
];

/// `AnimalWhereabouts` — where the animal is right now.
const List<ProofChoice> proofWhereabouts = [
  ProofChoice('WITH_ME', 'With me', 'معي'),
  ProofChoice('AT_VET', 'At a vet clinic', 'عند طبيب بيطري'),
  ProofChoice('AT_SHELTER', 'At a shelter', 'في مأوى'),
  ProofChoice('RELEASED_SAFELY', 'Released safely', 'تم إطلاقه بأمان'),
];

String proofChoiceLabel(List<ProofChoice> choices, String value, {required bool arabic}) {
  for (final c in choices) {
    if (c.value == value) return arabic ? c.ar : c.en;
  }
  return value;
}

/// Which proof a post accepts, and the copy/behaviour that follows from it.
/// A RESCUE post is proved by the person who rescued the animal; a LOST_PET
/// post by the person who found the pet. FOUND_STRAY posts are the finder's
/// own report, so there is nothing for anyone else to prove.
enum ProofPostKind {
  rescue(
    closedStatus: 'RESOLVED',
    entryEn: 'I rescued this animal',
    entryAr: 'قمت بإنقاذ هذا الحيوان',
    titleEn: 'Proof of rescue',
    titleAr: 'إثبات الإنقاذ',
    introEn: "Show the owner of this post that the animal is safe. They review your photos and details before closing the post.",
    introAr: 'أظهر لصاحب هذا المنشور أن الحيوان بأمان. سيراجع صورك وتفاصيلك قبل إغلاق المنشور.',
    photosEn: 'Photos of the animal now',
    photosAr: 'صور للحيوان الآن',
    storyHintEn: 'What did you do? Where is the animal now? Any care given?',
    storyHintAr: 'ماذا فعلت؟ أين الحيوان الآن؟ هل قدمت له رعاية؟',
    whenEn: 'When did you rescue it?',
    whenAr: 'متى قمت بإنقاذه؟',
    whereEn: 'Where did you rescue it?',
    whereAr: 'أين قمت بإنقاذه؟',
    confirmEn: 'This closes your post as resolved and cannot be undone.',
    confirmAr: 'سيؤدي هذا إلى إغلاق منشورك كمحلول ولا يمكن التراجع عنه.',
  ),
  foundPet(
    closedStatus: 'REUNITED',
    entryEn: 'I found this pet',
    entryAr: 'وجدت هذا الحيوان',
    titleEn: 'Proof of finding',
    titleAr: 'إثبات العثور',
    introEn: "Show the owner of this post that you have their pet. They review your photos and details before closing the post.",
    introAr: 'أظهر لصاحب هذا المنشور أن حيوانه الأليف معك. سيراجع صورك وتفاصيلك قبل إغلاق المنشور.',
    photosEn: 'Photos of the pet now',
    photosAr: 'صور للحيوان الأليف الآن',
    storyHintEn: 'Describe the pet (colour, markings, collar or tag) and how you found it.',
    storyHintAr: 'صف الحيوان (اللون، العلامات، الطوق أو البطاقة) وكيف وجدته.',
    whenEn: 'When did you find it?',
    whenAr: 'متى وجدته؟',
    whereEn: 'Where did you find it?',
    whereAr: 'أين وجدته؟',
    confirmEn: 'This closes your post as reunited and cannot be undone.',
    confirmAr: 'سيؤدي هذا إلى إغلاق منشورك كمُلمّ الشمل ولا يمكن التراجع عنه.',
  );

  /// The terminal post status the backend moves the post to on confirmation.
  final String closedStatus;
  final String entryEn, entryAr;
  final String titleEn, titleAr;
  final String introEn, introAr;
  final String photosEn, photosAr;
  final String storyHintEn, storyHintAr;
  final String whenEn, whenAr;
  final String whereEn, whereAr;
  final String confirmEn, confirmAr;

  const ProofPostKind({
    required this.closedStatus,
    required this.entryEn,
    required this.entryAr,
    required this.titleEn,
    required this.titleAr,
    required this.introEn,
    required this.introAr,
    required this.photosEn,
    required this.photosAr,
    required this.storyHintEn,
    required this.storyHintAr,
    required this.whenEn,
    required this.whenAr,
    required this.whereEn,
    required this.whereAr,
    required this.confirmEn,
    required this.confirmAr,
  });

  /// Null when the post can't receive a proof (feed-only post types, or a
  /// FOUND_STRAY report).
  static ProofPostKind? forPost({required String postType, String? lostReportType}) {
    if (postType == 'RESCUE') return ProofPostKind.rescue;
    if (postType == 'LOST' && lostReportType == 'LOST_PET') return ProofPostKind.foundPet;
    return null;
  }
}

class RescueProofMedia {
  final String id;
  final String publicUrl;
  const RescueProofMedia({required this.id, required this.publicUrl});

  factory RescueProofMedia.fromJson(Map<String, dynamic> json) => RescueProofMedia(
        id: json['id'] as String,
        publicUrl: json['publicUrl'] as String,
      );
}

/// The person who submitted a proof. Nullable on a [RescueProof] because the
/// account may since have been deleted.
class RescueProofSubmitter {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;

  const RescueProofSubmitter({required this.id, this.fullName, this.fullNameArabic, this.profilePictureUrl});

  factory RescueProofSubmitter.fromJson(Map<String, dynamic> json) => RescueProofSubmitter(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        fullNameArabic: json['fullNameArabic'] as String?,
        profilePictureUrl: json['profilePictureUrl'] as String?,
      );

  String? displayName({required bool arabic}) {
    final primary = arabic ? fullNameArabic : fullName;
    final secondary = arabic ? fullName : fullNameArabic;
    final name = (primary != null && primary.trim().isNotEmpty) ? primary : secondary;
    return (name != null && name.trim().isNotEmpty) ? name : null;
  }
}

/// A rescuer's / finder's proof that an animal was rescued or found.
///
/// `status` is one of PENDING (awaiting the owner), CONFIRMED (the owner
/// accepted it and the post was closed), REJECTED (the owner declined it), or
/// CLOSED (the post was closed without this proof being chosen).
class RescueProof {
  final String id;
  final String postId;
  final String status;
  final RescueProofSubmitter? submitter;
  final List<RescueProofMedia> media;
  final DateTime happenedAt;
  final String areaName;
  final String condition;
  final String whereabouts;
  final String story;
  final DateTime? respondedAt;
  final DateTime createdAt;

  const RescueProof({
    required this.id,
    required this.postId,
    required this.status,
    this.submitter,
    required this.media,
    required this.happenedAt,
    required this.areaName,
    required this.condition,
    required this.whereabouts,
    required this.story,
    this.respondedAt,
    required this.createdAt,
  });

  bool get isPending => status == 'PENDING';
  bool get isConfirmed => status == 'CONFIRMED';
  bool get isRejected => status == 'REJECTED';

  factory RescueProof.fromJson(Map<String, dynamic> json) => RescueProof(
        id: json['id'] as String,
        postId: json['postId'] as String,
        status: json['status'] as String,
        submitter: json['submitter'] != null ? RescueProofSubmitter.fromJson(json['submitter'] as Map<String, dynamic>) : null,
        media: (json['media'] as List<dynamic>? ?? const []).map((m) => RescueProofMedia.fromJson(m as Map<String, dynamic>)).toList(),
        happenedAt: DateTime.parse(json['happenedAt'] as String),
        areaName: json['areaName'] as String,
        condition: json['condition'] as String,
        whereabouts: json['whereabouts'] as String,
        story: json['story'] as String,
        respondedAt: json['respondedAt'] != null ? DateTime.parse(json['respondedAt'] as String) : null,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  RescueProof copyWith({String? status}) => RescueProof(
        id: id,
        postId: postId,
        status: status ?? this.status,
        submitter: submitter,
        media: media,
        happenedAt: happenedAt,
        areaName: areaName,
        condition: condition,
        whereabouts: whereabouts,
        story: story,
        respondedAt: respondedAt,
        createdAt: createdAt,
      );
}
