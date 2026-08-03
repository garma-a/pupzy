/// A nearby veterinary clinic, returned by `Post.nearestVetClinics` on
/// detail queries only. All distance/link fields are computed server-side.
class VetClinic {
  final String id;
  final String? nameEnglish;
  final String? nameArabic;
  final String? phoneNumber;
  final String? address;
  final String? website;
  final double latitude;
  final double longitude;
  final double distanceKm;
  final String googleMapsUrl;
  final String? whatsappPhoneUrl;

  const VetClinic({
    required this.id,
    this.nameEnglish,
    this.nameArabic,
    this.phoneNumber,
    this.address,
    this.website,
    required this.latitude,
    required this.longitude,
    required this.distanceKm,
    required this.googleMapsUrl,
    this.whatsappPhoneUrl,
  });

  factory VetClinic.fromJson(Map<String, dynamic> json) => VetClinic(
        id: json['id'] as String,
        nameEnglish: json['nameEnglish'] as String?,
        nameArabic: json['nameArabic'] as String?,
        phoneNumber: json['phoneNumber'] as String?,
        address: json['address'] as String?,
        website: json['website'] as String?,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        distanceKm: (json['distanceKm'] as num).toDouble(),
        googleMapsUrl: json['googleMapsUrl'] as String,
        whatsappPhoneUrl: json['whatsappPhoneUrl'] as String?,
      );
}
