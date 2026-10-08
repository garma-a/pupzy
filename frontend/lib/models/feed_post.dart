/// A post as returned by the backend's combined home feed.
/// Carries the base `Post` fields the GraphQL API exposes on feed queries,
/// plus a PRODUCT listing's price. Other extension-type fields (species,
/// breed, personality tags, etc.) come only from the per-post detail query.
class FeedPost {
  final String id;
  final String postType; // RESCUE, LOST, ADOPTION, PRODUCT
  final String title;
  final String description;
  final String status;
  final String? urgency; // CRITICAL, URGENT, MODERATE, or null
  final String cityNameEnglish;
  final String cityNameArabic;
  final String? areaName;
  final String? marketCategory;
  final int upvoteCount;
  final int saveCount;
  final int viewCount;
  final int commentCount;
  final bool isUpvotedByMe;
  final bool isSavedByMe;
  final List<String> mediaUrls;
  final double? distanceKm;
  final DateTime createdAt;

  /// Who posted it, so a card can tell the viewer's own posts apart (an owner
  /// cannot support or like their own post). Null when the feed omitted it.
  final String? creatorId;

  /// PRODUCT listings only (null for every other type, and when the feed did
  /// not include it): what Market cards show as the price.
  final double? priceAmount;
  final String? priceCurrency;
  final bool? isFree;

  const FeedPost({
    required this.id,
    required this.postType,
    required this.title,
    required this.description,
    required this.status,
    this.urgency,
    required this.cityNameEnglish,
    required this.cityNameArabic,
    this.areaName,
    this.marketCategory,
    required this.upvoteCount,
    required this.saveCount,
    required this.viewCount,
    this.commentCount = 0,
    required this.isUpvotedByMe,
    required this.isSavedByMe,
    required this.mediaUrls,
    this.distanceKm,
    required this.createdAt,
    this.creatorId,
    this.priceAmount,
    this.priceCurrency,
    this.isFree,
  });

  bool get isUrgent => urgency == 'CRITICAL';
  String? get primaryImageUrl => mediaUrls.isNotEmpty ? mediaUrls.first : null;

  factory FeedPost.fromEdgeJson(Map<String, dynamic> edge) {
    final node = edge['node'] as Map<String, dynamic>;
    final city = node['city'] as Map<String, dynamic>? ?? const {};
    final mediaList = (node['media'] as List<dynamic>? ?? [])
        .map((m) => m as Map<String, dynamic>)
        .toList()
      ..sort((a, b) => (a['displayOrder'] as int).compareTo(b['displayOrder'] as int));
    final product = node['product'] as Map<String, dynamic>?;

    return FeedPost(
      id: node['id'] as String,
      postType: node['postType'] as String,
      title: node['title'] as String,
      description: node['description'] as String,
      status: node['status'] as String,
      urgency: node['urgency'] as String?,
      cityNameEnglish: city['nameEnglish'] as String? ?? '',
      cityNameArabic: city['nameArabic'] as String? ?? '',
      areaName: node['areaName'] as String?,
      marketCategory: node['marketCategory'] as String?,
      upvoteCount: node['upvoteCount'] as int? ?? 0,
      saveCount: node['saveCount'] as int? ?? 0,
      viewCount: node['viewCount'] as int? ?? 0,
      commentCount: node['commentCount'] as int? ?? 0,
      isUpvotedByMe: node['isUpvotedByMe'] as bool? ?? false,
      isSavedByMe: node['isSavedByMe'] as bool? ?? false,
      mediaUrls: mediaList.map((m) => m['publicUrl'] as String).toList(),
      distanceKm: (edge['distanceKm'] as num?)?.toDouble(),
      createdAt: DateTime.parse(node['createdAt'] as String),
      creatorId: (node['creator'] as Map<String, dynamic>?)?['id'] as String?,
      priceAmount: (product?['priceAmount'] as num?)?.toDouble(),
      priceCurrency: product?['priceCurrency'] as String?,
      isFree: product?['isFree'] as bool?,
    );
  }

  FeedPost copyWith({
    int? upvoteCount,
    bool? isUpvotedByMe,
    int? saveCount,
    bool? isSavedByMe,
    String? status,
    int? commentCount,
  }) {
    return FeedPost(
      id: id,
      postType: postType,
      title: title,
      description: description,
      status: status ?? this.status,
      urgency: urgency,
      cityNameEnglish: cityNameEnglish,
      cityNameArabic: cityNameArabic,
      areaName: areaName,
      marketCategory: marketCategory,
      upvoteCount: upvoteCount ?? this.upvoteCount,
      saveCount: saveCount ?? this.saveCount,
      viewCount: viewCount,
      commentCount: commentCount ?? this.commentCount,
      isUpvotedByMe: isUpvotedByMe ?? this.isUpvotedByMe,
      isSavedByMe: isSavedByMe ?? this.isSavedByMe,
      mediaUrls: mediaUrls,
      distanceKm: distanceKm,
      createdAt: createdAt,
      creatorId: creatorId,
      priceAmount: priceAmount,
      priceCurrency: priceCurrency,
      isFree: isFree,
    );
  }
}
