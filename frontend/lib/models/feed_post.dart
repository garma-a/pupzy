/// A post as returned by the backend's combined home feed.
/// Only carries the base `Post` fields the GraphQL API exposes on feed
/// queries — extension-type fields (species, breed, price, personality
/// tags, etc.) are only available from the per-post detail query, which
/// isn't wired yet.
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
  final bool isUpvotedByMe;
  final bool isSavedByMe;
  final List<String> mediaUrls;
  final double? distanceKm;
  final DateTime createdAt;

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
    required this.isUpvotedByMe,
    required this.isSavedByMe,
    required this.mediaUrls,
    this.distanceKm,
    required this.createdAt,
  });

  bool get isUrgent => urgency == 'CRITICAL';
  String? get primaryImageUrl => mediaUrls.isNotEmpty ? mediaUrls.first : null;

  /// Case-insensitive substring match across every field a user would
  /// plausibly search by: title, description, category, and location.
  bool matchesQuery(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return title.toLowerCase().contains(q) ||
        description.toLowerCase().contains(q) ||
        (marketCategory?.toLowerCase().contains(q) ?? false) ||
        (areaName?.toLowerCase().contains(q) ?? false) ||
        cityNameEnglish.toLowerCase().contains(q) ||
        cityNameArabic.contains(query.trim());
  }

  factory FeedPost.fromEdgeJson(Map<String, dynamic> edge) {
    final node = edge['node'] as Map<String, dynamic>;
    final city = node['city'] as Map<String, dynamic>? ?? const {};
    final mediaList = (node['media'] as List<dynamic>? ?? [])
        .map((m) => m as Map<String, dynamic>)
        .toList()
      ..sort((a, b) => (a['displayOrder'] as int).compareTo(b['displayOrder'] as int));

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
      isUpvotedByMe: node['isUpvotedByMe'] as bool? ?? false,
      isSavedByMe: node['isSavedByMe'] as bool? ?? false,
      mediaUrls: mediaList.map((m) => m['publicUrl'] as String).toList(),
      distanceKm: (edge['distanceKm'] as num?)?.toDouble(),
      createdAt: DateTime.parse(node['createdAt'] as String),
    );
  }

  FeedPost copyWith({
    int? upvoteCount,
    bool? isUpvotedByMe,
    int? saveCount,
    bool? isSavedByMe,
    String? status,
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
      isUpvotedByMe: isUpvotedByMe ?? this.isUpvotedByMe,
      isSavedByMe: isSavedByMe ?? this.isSavedByMe,
      mediaUrls: mediaUrls,
      distanceKm: distanceKm,
      createdAt: createdAt,
    );
  }
}
