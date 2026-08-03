class AdoptionApplicationUser {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;

  const AdoptionApplicationUser({required this.id, this.fullName, this.fullNameArabic, this.profilePictureUrl});

  factory AdoptionApplicationUser.fromJson(Map<String, dynamic> json) => AdoptionApplicationUser(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        fullNameArabic: json['fullNameArabic'] as String?,
        profilePictureUrl: json['profilePictureUrl'] as String?,
      );
}

/// A submitted adoption-questionnaire application for an ADOPTION post.
class AdoptionApplication {
  final String id;
  final String targetPostId;
  final AdoptionApplicationUser applicant;
  final String status; // PENDING, APPROVED, REJECTED
  final String? speciesPreference;
  final String? breedPreference;
  final String? agePreference;
  final String? genderPreference;
  final String livingSituation;
  final bool hasOutdoorAccess;
  final bool hasOtherPetsAtHome;
  final bool hasChildrenAtHome;
  final int? hoursAtHomePerDay;
  final String? previousPetExperience;
  final String whyAdopt;
  final bool consentHomeVisit;
  final bool canProvideVetReference;
  final DateTime? respondedAt;
  final DateTime createdAt;

  const AdoptionApplication({
    required this.id,
    required this.targetPostId,
    required this.applicant,
    required this.status,
    this.speciesPreference,
    this.breedPreference,
    this.agePreference,
    this.genderPreference,
    required this.livingSituation,
    required this.hasOutdoorAccess,
    required this.hasOtherPetsAtHome,
    required this.hasChildrenAtHome,
    this.hoursAtHomePerDay,
    this.previousPetExperience,
    required this.whyAdopt,
    required this.consentHomeVisit,
    required this.canProvideVetReference,
    this.respondedAt,
    required this.createdAt,
  });

  factory AdoptionApplication.fromJson(Map<String, dynamic> json) => AdoptionApplication(
        id: json['id'] as String,
        targetPostId: json['targetPostId'] as String,
        applicant: AdoptionApplicationUser.fromJson(json['applicant'] as Map<String, dynamic>),
        status: json['status'] as String,
        speciesPreference: json['speciesPreference'] as String?,
        breedPreference: json['breedPreference'] as String?,
        agePreference: json['agePreference'] as String?,
        genderPreference: json['genderPreference'] as String?,
        livingSituation: json['livingSituation'] as String,
        hasOutdoorAccess: json['hasOutdoorAccess'] as bool? ?? false,
        hasOtherPetsAtHome: json['hasOtherPetsAtHome'] as bool? ?? false,
        hasChildrenAtHome: json['hasChildrenAtHome'] as bool? ?? false,
        hoursAtHomePerDay: json['hoursAtHomePerDay'] as int?,
        previousPetExperience: json['previousPetExperience'] as String?,
        whyAdopt: json['whyAdopt'] as String,
        consentHomeVisit: json['consentHomeVisit'] as bool? ?? false,
        canProvideVetReference: json['canProvideVetReference'] as bool? ?? false,
        respondedAt: json['respondedAt'] != null ? DateTime.parse(json['respondedAt'] as String) : null,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
