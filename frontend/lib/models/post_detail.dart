import 'vet_clinic.dart';

/// The creator of a post, as returned on the detail query.
class PostDetailUser {
  final String id;
  final String? fullName;
  final String? fullNameArabic;
  final String? profilePictureUrl;
  final bool isVerified;
  final DateTime createdAt;
  final int productPostCount;

  const PostDetailUser({
    required this.id,
    this.fullName,
    this.fullNameArabic,
    this.profilePictureUrl,
    required this.isVerified,
    required this.createdAt,
    required this.productPostCount,
  });

  factory PostDetailUser.fromJson(Map<String, dynamic> json) => PostDetailUser(
        id: json['id'] as String,
        fullName: json['fullName'] as String?,
        fullNameArabic: json['fullNameArabic'] as String?,
        profilePictureUrl: json['profilePictureUrl'] as String?,
        isVerified: json['isVerified'] as bool? ?? false,
        createdAt: DateTime.parse(json['createdAt'] as String),
        productPostCount: json['productPostCount'] as int? ?? 0,
      );
}

/// Base post fields for a detail screen — same shape as the feed's Post,
/// plus the creator and precise coordinates (RESCUE/LOST only).
class PostDetail {
  final String id;
  final PostDetailUser creator;
  final String postType;
  final String title;
  final String description;
  final String status;
  final String? urgency;
  final String cityNameEnglish;
  final String cityNameArabic;
  final String? areaName;
  final double? latitude;
  final double? longitude;
  final String? marketCategory;
  final int upvoteCount;
  final int saveCount;
  final int viewCount;
  final bool isUpvotedByMe;
  final bool isSavedByMe;
  final List<String> mediaUrls;
  final List<VetClinic> vetClinics;
  final DateTime createdAt;

  const PostDetail({
    required this.id,
    required this.creator,
    required this.postType,
    required this.title,
    required this.description,
    required this.status,
    this.urgency,
    required this.cityNameEnglish,
    required this.cityNameArabic,
    this.areaName,
    this.latitude,
    this.longitude,
    this.marketCategory,
    required this.upvoteCount,
    required this.saveCount,
    required this.viewCount,
    required this.isUpvotedByMe,
    required this.isSavedByMe,
    required this.mediaUrls,
    required this.vetClinics,
    required this.createdAt,
  });

  bool get isUrgent => urgency == 'CRITICAL';

  factory PostDetail.fromJson(Map<String, dynamic> json) {
    final city = json['city'] as Map<String, dynamic>? ?? const {};
    final coords = json['coordinates'] as Map<String, dynamic>?;
    final mediaList = (json['media'] as List<dynamic>? ?? [])
        .map((m) => m as Map<String, dynamic>)
        .toList()
      ..sort((a, b) => (a['displayOrder'] as int).compareTo(b['displayOrder'] as int));
    final vetClinics = (json['nearestVetClinics'] as List<dynamic>? ?? [])
        .map((v) => VetClinic.fromJson(v as Map<String, dynamic>))
        .toList();

    return PostDetail(
      id: json['id'] as String,
      creator: PostDetailUser.fromJson(json['creator'] as Map<String, dynamic>),
      postType: json['postType'] as String,
      title: json['title'] as String,
      description: json['description'] as String,
      status: json['status'] as String,
      urgency: json['urgency'] as String?,
      cityNameEnglish: city['nameEnglish'] as String? ?? '',
      cityNameArabic: city['nameArabic'] as String? ?? '',
      areaName: json['areaName'] as String?,
      latitude: (coords?['latitude'] as num?)?.toDouble(),
      longitude: (coords?['longitude'] as num?)?.toDouble(),
      marketCategory: json['marketCategory'] as String?,
      upvoteCount: json['upvoteCount'] as int? ?? 0,
      saveCount: json['saveCount'] as int? ?? 0,
      viewCount: json['viewCount'] as int? ?? 0,
      isUpvotedByMe: json['isUpvotedByMe'] as bool? ?? false,
      isSavedByMe: json['isSavedByMe'] as bool? ?? false,
      mediaUrls: mediaList.map((m) => m['publicUrl'] as String).toList(),
      vetClinics: vetClinics,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  PostDetail copyWith({int? upvoteCount, bool? isUpvotedByMe, int? saveCount, bool? isSavedByMe, String? status}) {
    return PostDetail(
      id: id,
      creator: creator,
      postType: postType,
      title: title,
      description: description,
      status: status ?? this.status,
      urgency: urgency,
      cityNameEnglish: cityNameEnglish,
      cityNameArabic: cityNameArabic,
      areaName: areaName,
      latitude: latitude,
      longitude: longitude,
      marketCategory: marketCategory,
      upvoteCount: upvoteCount ?? this.upvoteCount,
      saveCount: saveCount ?? this.saveCount,
      viewCount: viewCount,
      isUpvotedByMe: isUpvotedByMe ?? this.isUpvotedByMe,
      isSavedByMe: isSavedByMe ?? this.isSavedByMe,
      mediaUrls: mediaUrls,
      vetClinics: vetClinics,
      createdAt: createdAt,
    );
  }
}

/// RESCUE-only extension fields.
class RescuePostExtension {
  final String species;
  final String conditionSummary;
  final String reporterRole;

  const RescuePostExtension({required this.species, required this.conditionSummary, required this.reporterRole});

  factory RescuePostExtension.fromJson(Map<String, dynamic> json) => RescuePostExtension(
        species: json['species'] as String,
        conditionSummary: json['conditionSummary'] as String,
        reporterRole: json['reporterRole'] as String,
      );
}

/// LOST-only extension fields (covers both LOST_PET and FOUND_STRAY).
class LostPostExtension {
  final String reportType;
  final String species;
  final String? breed;
  final String? colorAndMarkings;
  final bool? hasCollarWithIdentificationTag;
  final String? circumstances;
  final String? petName;
  final String? dateLastSeen;
  final String? currentCondition;
  final bool? isCurrentlySafeWithReporter;
  final String? dateFound;

  const LostPostExtension({
    required this.reportType,
    required this.species,
    this.breed,
    this.colorAndMarkings,
    this.hasCollarWithIdentificationTag,
    this.circumstances,
    this.petName,
    this.dateLastSeen,
    this.currentCondition,
    this.isCurrentlySafeWithReporter,
    this.dateFound,
  });

  factory LostPostExtension.fromJson(Map<String, dynamic> json) => LostPostExtension(
        reportType: json['reportType'] as String,
        species: json['species'] as String,
        breed: json['breed'] as String?,
        colorAndMarkings: json['colorAndMarkings'] as String?,
        hasCollarWithIdentificationTag: json['hasCollarWithIdentificationTag'] as bool?,
        circumstances: json['circumstances'] as String?,
        petName: json['petName'] as String?,
        dateLastSeen: json['dateLastSeen'] as String?,
        currentCondition: json['currentCondition'] as String?,
        isCurrentlySafeWithReporter: json['isCurrentlySafeWithReporter'] as bool?,
        dateFound: json['dateFound'] as String?,
      );
}

/// ADOPTION-only extension fields.
class AdoptionPostExtension {
  final String petName;
  final String species;
  final String? breed;
  final int? ageValue;
  final String? ageUnit;
  final String gender;
  final bool vaccinated;
  final bool neutered;
  final String? healthNotes;
  final List<String> personalityTags;
  final String? spaceRequirement;
  final bool priorPetExperienceRequired;
  final String? additionalRequirements;
  final String? currentlyWith;

  const AdoptionPostExtension({
    required this.petName,
    required this.species,
    this.breed,
    this.ageValue,
    this.ageUnit,
    required this.gender,
    required this.vaccinated,
    required this.neutered,
    this.healthNotes,
    required this.personalityTags,
    this.spaceRequirement,
    required this.priorPetExperienceRequired,
    this.additionalRequirements,
    this.currentlyWith,
  });

  factory AdoptionPostExtension.fromJson(Map<String, dynamic> json) => AdoptionPostExtension(
        petName: json['petName'] as String,
        species: json['species'] as String,
        breed: json['breed'] as String?,
        ageValue: json['ageValue'] as int?,
        ageUnit: json['ageUnit'] as String?,
        gender: json['gender'] as String,
        vaccinated: json['vaccinated'] as bool? ?? false,
        neutered: json['neutered'] as bool? ?? false,
        healthNotes: json['healthNotes'] as String?,
        personalityTags: (json['personalityTags'] as List<dynamic>? ?? []).map((t) => t as String).toList(),
        spaceRequirement: json['spaceRequirement'] as String?,
        priorPetExperienceRequired: json['priorPetExperienceRequired'] as bool? ?? false,
        additionalRequirements: json['additionalRequirements'] as String?,
        currentlyWith: json['currentlyWith'] as String?,
      );
}

/// PRODUCT-only extension fields.
class ProductPostExtension {
  final String category;
  final String condition;
  final double? priceAmount;
  final String priceCurrency;
  final bool isFree;
  final bool openToOffers;

  const ProductPostExtension({
    required this.category,
    required this.condition,
    this.priceAmount,
    required this.priceCurrency,
    required this.isFree,
    required this.openToOffers,
  });

  factory ProductPostExtension.fromJson(Map<String, dynamic> json) => ProductPostExtension(
        category: json['category'] as String,
        condition: json['condition'] as String,
        priceAmount: (json['priceAmount'] as num?)?.toDouble(),
        priceCurrency: json['priceCurrency'] as String? ?? 'EGP',
        isFree: json['isFree'] as bool? ?? false,
        openToOffers: json['openToOffers'] as bool? ?? false,
      );
}
