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

  /// The address in each language; [address] is the server's single
  /// address, which prefers English. Use [addressFor].
  final String? addressEnglish;
  final String? addressArabic;

  /// Open around the clock. False means "not stated", not "closed at night".
  final bool is24Hours;
  final String? facebookUrl;

  /// Only the clinic's area is known: it sits on the area's centre, so its
  /// distance is approximate and [googleMapsUrl] is a search, not a pin.
  final bool isApproximateLocation;

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
    this.addressEnglish,
    this.addressArabic,
    this.is24Hours = false,
    this.facebookUrl,
    this.isApproximateLocation = false,
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
    // Absent on servers before the clinic release: all optional.
    addressEnglish: json['addressEnglish'] as String?,
    addressArabic: json['addressArabic'] as String?,
    is24Hours: json['is24Hours'] as bool? ?? false,
    facebookUrl: json['facebookUrl'] as String?,
    isApproximateLocation: json['isApproximateLocation'] as bool? ?? false,
  );

  /// The address in the shown language, falling back to whichever exists.
  String? addressFor(bool isArabic) =>
      isArabic ? (addressArabic ?? address ?? addressEnglish) : (addressEnglish ?? address ?? addressArabic);
}
