enum ListingStatus { available, reserved, sold }

class Product {
  final String id;
  final String title;
  final List<String> imageUrls;
  final double? price;
  final String currency;
  final bool isFree;
  final bool openToOffers;
  final String description;
  final String category;
  final String condition;
  final String location;
  final ListingStatus status;
  final DateTime createdAt;
  final int viewCount;
  final int saveCount;

  // Seller info — mock/local for now, no backend query exists yet to fetch this.
  final String sellerId;
  final String sellerName;
  final String? sellerAvatarUrl;
  final DateTime sellerJoinDate;
  final int sellerActiveListingsCount;
  final String? sellerPhone;

  const Product({
    required this.id,
    required this.title,
    required this.imageUrls,
    this.price,
    this.currency = 'EGP',
    this.isFree = false,
    this.openToOffers = false,
    required this.description,
    required this.category,
    required this.condition,
    required this.location,
    this.status = ListingStatus.available,
    required this.createdAt,
    this.viewCount = 0,
    this.saveCount = 0,
    required this.sellerId,
    required this.sellerName,
    this.sellerAvatarUrl,
    required this.sellerJoinDate,
    this.sellerActiveListingsCount = 0,
    this.sellerPhone,
  });

  Product copyWith({
    List<String>? imageUrls,
    double? price,
    bool? isFree,
    bool? openToOffers,
    String? description,
    String? category,
    String? condition,
    String? title,
    ListingStatus? status,
  }) {
    return Product(
      id: id,
      title: title ?? this.title,
      imageUrls: imageUrls ?? this.imageUrls,
      price: price ?? this.price,
      currency: currency,
      isFree: isFree ?? this.isFree,
      openToOffers: openToOffers ?? this.openToOffers,
      description: description ?? this.description,
      category: category ?? this.category,
      condition: condition ?? this.condition,
      location: location,
      status: status ?? this.status,
      createdAt: createdAt,
      viewCount: viewCount,
      saveCount: saveCount,
      sellerId: sellerId,
      sellerName: sellerName,
      sellerAvatarUrl: sellerAvatarUrl,
      sellerJoinDate: sellerJoinDate,
      sellerActiveListingsCount: sellerActiveListingsCount,
      sellerPhone: sellerPhone,
    );
  }
}
