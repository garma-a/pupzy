class Product {
  final String id;
  final String name;
  final List<String> imageUrls;
  final double price;
  final String currency;
  final double rating;
  final int reviewCount;
  final String description;
  final String category;

  const Product({
    required this.id,
    required this.name,
    required this.imageUrls,
    required this.price,
    this.currency = 'EGP',
    required this.rating,
    required this.reviewCount,
    required this.description,
    required this.category,
  });
}
