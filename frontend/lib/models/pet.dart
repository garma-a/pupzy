class AdoptionPet {
  final String id;
  final String name;
  final List<String> imageUrls;
  final String breed;
  final String age;
  final String gender;
  final String location;
  final String description;
  final double adoptionFee;
  final String species;
  final List<String> traits;
  final int boostCount;
  final double distance;

  const AdoptionPet({
    required this.id,
    required this.name,
    required this.imageUrls,
    required this.breed,
    required this.age,
    required this.gender,
    required this.location,
    required this.description,
    required this.adoptionFee,
    this.species = 'Dog',
    this.traits = const [],
    this.boostCount = 0,
    this.distance = 0,
  });
}

class RescueAnimal {
  final String id;
  final String name;
  final List<String> imageUrls;
  final String breed;
  final String location;
  final String description;
  final bool isUrgent;
  final String contactName;
  final String contactPhone;
  final double distance;
  final String timeAgoLabel;
  final int boostCount;
  final String species;

  const RescueAnimal({
    required this.id,
    required this.name,
    required this.imageUrls,
    required this.breed,
    required this.location,
    required this.description,
    required this.isUrgent,
    required this.contactName,
    required this.contactPhone,
    this.distance = 0,
    this.timeAgoLabel = '',
    this.boostCount = 0,
    this.species = 'Dog',
  });
}
