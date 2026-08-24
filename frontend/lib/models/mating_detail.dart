/// MATING-only extension fields, fetched separately from the base post via
/// `matingPostDetail(postId)` — same pattern as rescue/lost/adoption/product.
class MatingDetails {
  final String petName;
  final String species;
  final String breed;
  final String gender;
  final int ageValue;
  final String ageUnit;
  final bool isPurebred;
  final bool hasPedigreeCertificate;
  final bool vaccinated;
  final bool dewormed;
  final String? termsSummary;
  final String? matingConditions;

  const MatingDetails({
    required this.petName,
    required this.species,
    required this.breed,
    required this.gender,
    required this.ageValue,
    required this.ageUnit,
    required this.isPurebred,
    required this.hasPedigreeCertificate,
    required this.vaccinated,
    required this.dewormed,
    this.termsSummary,
    this.matingConditions,
  });

  factory MatingDetails.fromJson(Map<String, dynamic> json) => MatingDetails(
        petName: json['petName'] as String,
        species: json['species'] as String,
        breed: json['breed'] as String,
        gender: json['gender'] as String,
        ageValue: json['ageValue'] as int,
        ageUnit: json['ageUnit'] as String,
        isPurebred: json['isPurebred'] as bool,
        hasPedigreeCertificate: json['hasPedigreeCertificate'] as bool,
        vaccinated: json['vaccinated'] as bool,
        dewormed: json['dewormed'] as bool,
        termsSummary: json['termsSummary'] as String?,
        matingConditions: json['matingConditions'] as String?,
      );
}
