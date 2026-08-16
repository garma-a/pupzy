import 'package:flutter/foundation.dart';
import 'package:graphql_flutter/graphql_flutter.dart';

import '../config/api_config.dart';
import '../models/adoption_application.dart';
import '../models/app_notification.dart';
import '../models/contact_request.dart';
import '../models/feed_post.dart';
import '../models/post_detail.dart';
import 'auth_service.dart';

class GraphQLService {
  late final ValueNotifier<GraphQLClient> client;
  final AuthService _authService;

  GraphQLService(this._authService) {
    final httpLink = HttpLink(
      kIsWeb ? ApiConfig.graphqlEndpointWeb : ApiConfig.graphqlEndpoint,
    );

    final authLink = AuthLink(getToken: () async {
      final token = await _authService.getIdToken();
      return token != null ? 'Bearer $token' : null;
    });

    final link = authLink.concat(httpLink);

    client = ValueNotifier(
      GraphQLClient(
        link: link,
        cache: GraphQLCache(store: InMemoryStore()),
      ),
    );
  }

  static const String meQuery = r'''
    query Me {
      me {
        id
        email
        fullName
        profilePictureUrl
        isVerified
        profileComplete
        phoneNumber
        homeCityId
        city {
          id
          nameEnglish
          nameArabic
          governorate
        }
        fullNameArabic
        postCount
        rescuePostCount
        lostPostCount
        adoptionPostCount
        productPostCount
        languagePreference
        notificationsEnabled
        lastSeenAt
        createdAt
        updatedAt
      }
    }
  ''';

  static const String citiesQuery = r'''
    query GetCities {
      cities {
        id
        nameEnglish
        nameArabic
        governorate
      }
    }
  ''';

  static const String completeProfileMutation = r'''
    mutation CompleteProfile($input: CompleteProfileInput!) {
      completeProfile(input: $input) {
        id
        fullName
        phoneNumber
        homeCityId
        profileComplete
      }
    }
  ''';

  static const String updateProfileMutation = r'''
    mutation UpdateProfile($input: UpdateProfileInput!) {
      updateProfile(input: $input) {
        id
        fullName
        phoneNumber
        profileComplete
      }
    }
  ''';

  static const String updateMyLocationMutation = r'''
    mutation UpdateMyLocation($location: GeoLocationInput!) {
      updateMyLocation(location: $location) {
        id
        homeCityId
        city {
          id
          nameEnglish
          nameArabic
          governorate
        }
      }
    }
  ''';

  static const String requestMediaUploadUrlMutation = r'''
    mutation RequestMediaUploadUrl($input: RequestMediaUploadInput!) {
      requestMediaUploadUrl(input: $input) {
        mediaId
        uploadUrl
        expiresAt
      }
    }
  ''';

  static const String createRescuePostMutation = r'''
    mutation CreateRescuePost($input: CreateRescuePostInput!) {
      createRescuePost(input: $input) {
        id
        title
      }
    }
  ''';

  static const String createLostPostMutation = r'''
    mutation CreateLostPost($input: CreateLostPostInput!) {
      createLostPost(input: $input) {
        id
        title
      }
    }
  ''';

  static const String createAdoptionPostMutation = r'''
    mutation CreateAdoptionPost($input: CreateAdoptionPostInput!) {
      createAdoptionPost(input: $input) {
        id
        title
      }
    }
  ''';

  static const String createProductPostMutation = r'''
    mutation CreateProductPost($input: CreateProductPostInput!) {
      createProductPost(input: $input) {
        id
        title
      }
    }
  ''';

  /// Shared field selection for every feed's PostConnection — reused by
  /// homeFeed/helpFeed/marketFeed so the shape stays identical everywhere.
  static const String _feedConnectionFields = r'''
    edges {
      cursor
      distanceKm
      node {
        id
        postType
        title
        description
        status
        urgency
        areaName
        marketCategory
        upvoteCount
        saveCount
        viewCount
        isUpvotedByMe
        isSavedByMe
        createdAt
        city {
          id
          nameEnglish
          nameArabic
          governorate
        }
        media {
          publicUrl
          displayOrder
        }
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  ''';

  static final String homeFeedQuery = '''
    query HomeFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$first: Int, \$after: String) {
      homeFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String helpFeedQuery = '''
    query HelpFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$first: Int, \$after: String) {
      helpFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String adoptFeedQuery = '''
    query AdoptFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$sort: AdoptFeedSort, \$first: Int, \$after: String) {
      adoptFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, sort: \$sort, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String marketFeedQuery = '''
    query MarketFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$category: ProductCategory, \$sort: MarketFeedSort, \$first: Int, \$after: String) {
      marketFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, category: \$category, sort: \$sort, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static const String postDetailQuery = r'''
    query PostDetail($id: ID!) {
      post(id: $id) {
        id
        postType
        title
        description
        status
        urgency
        areaName
        marketCategory
        upvoteCount
        saveCount
        viewCount
        isUpvotedByMe
        isSavedByMe
        createdAt
        coordinates {
          latitude
          longitude
        }
        city {
          id
          nameEnglish
          nameArabic
          governorate
        }
        media {
          publicUrl
          displayOrder
        }
        creator {
          id
          fullName
          fullNameArabic
          profilePictureUrl
          isVerified
          createdAt
          productPostCount
        }
        nearestVetClinics {
          id
          nameEnglish
          nameArabic
          phoneNumber
          address
          website
          latitude
          longitude
          distanceKm
          googleMapsUrl
          whatsappPhoneUrl
        }
      }
    }
  ''';

  static const String rescuePostDetailQuery = r'''
    query RescuePostDetail($postId: ID!) {
      rescuePostDetail(postId: $postId) {
        species
        conditionSummary
        reporterRole
      }
    }
  ''';

  static const String lostPostDetailQuery = r'''
    query LostPostDetail($postId: ID!) {
      lostPostDetail(postId: $postId) {
        reportType
        species
        breed
        colorAndMarkings
        hasCollarWithIdentificationTag
        circumstances
        petName
        dateLastSeen
        currentCondition
        isCurrentlySafeWithReporter
        dateFound
      }
    }
  ''';

  static const String adoptionPostDetailQuery = r'''
    query AdoptionPostDetail($postId: ID!) {
      adoptionPostDetail(postId: $postId) {
        petName
        species
        breed
        ageValue
        ageUnit
        gender
        vaccinated
        neutered
        healthNotes
        personalityTags
        spaceRequirement
        priorPetExperienceRequired
        additionalRequirements
        currentlyWith
      }
    }
  ''';

  static const String productPostDetailQuery = r'''
    query ProductPostDetail($postId: ID!) {
      productPostDetail(postId: $postId) {
        category
        condition
        priceAmount
        priceCurrency
        isFree
        openToOffers
      }
    }
  ''';

  static const String toggleUpvoteMutation = r'''
    mutation ToggleUpvote($postId: ID!) {
      toggleUpvote(postId: $postId) {
        id
        upvoteCount
        isUpvotedByMe
      }
    }
  ''';

  static const String toggleSaveMutation = r'''
    mutation ToggleSave($postId: ID!) {
      toggleSave(postId: $postId) {
        id
        saveCount
        isSavedByMe
      }
    }
  ''';

  static const String updatePostStatusMutation = r'''
    mutation UpdatePostStatus($postId: ID!, $status: PostStatus!) {
      updatePostStatus(postId: $postId, status: $status) {
        id
        status
      }
    }
  ''';

  static const String deletePostMutation = r'''
    mutation DeletePost($postId: ID!) {
      deletePost(postId: $postId)
    }
  ''';

  static const String recordViewMutation = r'''
    mutation RecordView($postId: ID!) {
      recordView(postId: $postId)
    }
  ''';

  // ─── Contact requests ─────────────────────────────────────────────────

  static const String _contactRequestFields = r'''
    id
    postId
    message
    status
    whatsappLink
    respondedAt
    createdAt
    requester {
      id
      fullName
      fullNameArabic
      profilePictureUrl
    }
  ''';

  static final String myContactRequestsQuery = '''
    query MyContactRequests(\$postId: ID, \$status: RequestStatus, \$first: Int, \$after: String) {
      myContactRequests(postId: \$postId, status: \$status, first: \$first, after: \$after) {
        edges {
          cursor
          node { $_contactRequestFields }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  ''';

  static final String postContactRequestsQuery = '''
    query PostContactRequests(\$postId: ID!, \$status: RequestStatus, \$first: Int, \$after: String) {
      postContactRequests(postId: \$postId, status: \$status, first: \$first, after: \$after) {
        edges {
          cursor
          node { $_contactRequestFields }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  ''';

  static const String getWhatsAppLinkQuery = r'''
    query GetWhatsAppLink($requestId: ID!) {
      getWhatsAppLink(requestId: $requestId)
    }
  ''';

  static const String getProductSellerContactQuery = r'''
    query GetProductSellerContact($postId: ID!) {
      getProductSellerContact(postId: $postId)
    }
  ''';

  static final String requestContactMutation = '''
    mutation RequestContact(\$postId: ID!, \$message: String!) {
      requestContact(postId: \$postId, message: \$message) { $_contactRequestFields }
    }
  ''';

  static final String approveContactRequestMutation = '''
    mutation ApproveContactRequest(\$requestId: ID!) {
      approveContactRequest(requestId: \$requestId) { $_contactRequestFields }
    }
  ''';

  static final String rejectContactRequestMutation = '''
    mutation RejectContactRequest(\$requestId: ID!) {
      rejectContactRequest(requestId: \$requestId) { $_contactRequestFields }
    }
  ''';

  // ─── Adoption applications ────────────────────────────────────────────

  static const String _adoptionApplicationFields = r'''
    id
    targetPostId
    status
    speciesPreference
    breedPreference
    agePreference
    genderPreference
    livingSituation
    hasOutdoorAccess
    hasOtherPetsAtHome
    hasChildrenAtHome
    hoursAtHomePerDay
    previousPetExperience
    whyAdopt
    consentHomeVisit
    canProvideVetReference
    respondedAt
    createdAt
    applicant {
      id
      fullName
      fullNameArabic
      profilePictureUrl
    }
  ''';

  static final String myAdoptionApplicationsQuery = '''
    query MyAdoptionApplications(\$first: Int, \$after: String) {
      myAdoptionApplications(first: \$first, after: \$after) {
        edges {
          cursor
          node { $_adoptionApplicationFields }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  ''';

  static final String postAdoptionApplicationsQuery = '''
    query PostAdoptionApplications(\$postId: ID!, \$status: RequestStatus, \$first: Int, \$after: String) {
      postAdoptionApplications(postId: \$postId, status: \$status, first: \$first, after: \$after) {
        edges {
          cursor
          node { $_adoptionApplicationFields }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  ''';

  static final String submitAdoptionApplicationMutation = '''
    mutation SubmitAdoptionApplication(\$input: SubmitAdoptionApplicationInput!) {
      submitAdoptionApplication(input: \$input) { $_adoptionApplicationFields }
    }
  ''';

  static final String approveAdoptionApplicationMutation = '''
    mutation ApproveAdoptionApplication(\$applicationId: ID!) {
      approveAdoptionApplication(applicationId: \$applicationId) { $_adoptionApplicationFields }
    }
  ''';

  static final String rejectAdoptionApplicationMutation = '''
    mutation RejectAdoptionApplication(\$applicationId: ID!) {
      rejectAdoptionApplication(applicationId: \$applicationId) { $_adoptionApplicationFields }
    }
  ''';

  // ─── Notifications ─────────────────────────────────────────────────────

  static const String _notificationFields = r'''
    id
    type
    title
    body
    relatedPostId
    isRead
    createdAt
  ''';

  static final String myNotificationsQuery = '''
    query MyNotifications(\$first: Int, \$after: String) {
      myNotifications(first: \$first, after: \$after) {
        edges {
          cursor
          node { $_notificationFields }
        }
        pageInfo { endCursor hasNextPage }
        unreadCount
      }
    }
  ''';

  static const String myUnreadNotificationCountQuery = r'''
    query MyUnreadNotificationCount {
      myUnreadNotificationCount
    }
  ''';

  static const String markNotificationReadMutation = r'''
    mutation MarkNotificationRead($notificationId: ID!) {
      markNotificationRead(notificationId: $notificationId) {
        id
        isRead
      }
    }
  ''';

  static const String markAllNotificationsReadMutation = r'''
    mutation MarkAllNotificationsRead {
      markAllNotificationsRead
    }
  ''';

  Future<Map<String, dynamic>?> fetchMe() async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(meQuery),
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['me'];
  }

  /// Resolves the viewer's home-city governorate + cityId — every feed
  /// query (home/help/market) needs these. Returns (null, null) if the
  /// profile has no city set yet or the request fails.
  Future<(String? governorate, String? cityId)> resolveViewerCity() async {
    final me = await fetchMe();
    final city = me?['city'] as Map<String, dynamic>?;
    return (city?['governorate'] as String?, city?['id'] as String?);
  }

  Future<List<Map<String, dynamic>>> fetchCities() async {
    final result = await client.value.query(
      QueryOptions(document: gql(citiesQuery)),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return [];
    }
    final list = result.data?['cities'] as List<dynamic>?;
    return list?.cast<Map<String, dynamic>>() ?? [];
  }

  /// Extracts a human-readable message from a failed GraphQL result.
  /// Prefers the server's own error message (e.g. a specific validation
  /// reason like "phoneNumber: must be in E.164 format") over a generic
  /// "something went wrong" — the backend already sends one, this just
  /// stops discarding it. Returns null for network-level failures (no
  /// response reached the server at all), which the caller should show a
  /// generic connectivity message for instead.
  String? _serverErrorMessage(OperationException? exception) {
    if (exception == null) return null;
    if (exception.graphqlErrors.isNotEmpty) {
      return exception.graphqlErrors.first.message;
    }
    return null;
  }

  /// Returns the created/updated profile on success, or `(null, message)`
  /// on failure — [message] is the specific reason when the server sent
  /// one (validation error, expired session, etc.), or null for a network
  /// failure (server unreachable).
  Future<(Map<String, dynamic>? data, String? errorMessage)> completeProfile({
    required String fullName,
    required String phoneNumber,
    required String cityId,
    double? latitude,
    double? longitude,
  }) async {
    final input = <String, dynamic>{
      'fullName': fullName,
      'phoneNumber': phoneNumber,
      'cityId': cityId,
    };
    if (latitude != null && longitude != null) {
      input['location'] = {
        'latitude': latitude,
        'longitude': longitude,
      };
    }
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(completeProfileMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['completeProfile'] as Map<String, dynamic>?, null);
  }

  Future<Map<String, dynamic>?> updateProfile({
    required String fullName,
    String? phoneNumber,
  }) async {
    final input = <String, dynamic>{'fullName': fullName};
    if (phoneNumber != null && phoneNumber.isNotEmpty) {
      input['phoneNumber'] = phoneNumber;
    }
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(updateProfileMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['updateProfile'];
  }

  Future<Map<String, dynamic>?> updateMyLocation({
    required double latitude,
    required double longitude,
  }) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(updateMyLocationMutation),
        variables: {
          'location': {
            'latitude': latitude,
            'longitude': longitude,
          },
        },
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['updateMyLocation'];
  }

  Future<Map<String, dynamic>?> requestMediaUploadUrl({
    required String contentType,
    required int fileSizeBytes,
  }) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(requestMediaUploadUrlMutation),
        variables: {
          'input': {
            'contentType': contentType,
            'fileSizeBytes': fileSizeBytes,
          },
        },
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['requestMediaUploadUrl'];
  }

  Future<Map<String, dynamic>?> createRescuePost({
    required String title,
    required String description,
    required double latitude,
    required double longitude,
    String? areaName,
    required String urgency,
    required String species,
    required String conditionSummary,
    required String reporterRole,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'title': title,
      'description': description,
      'coordinates': {'latitude': latitude, 'longitude': longitude},
      'urgency': urgency,
      'species': species,
      'conditionSummary': conditionSummary,
      'reporterRole': reporterRole,
    };
    if (areaName != null && areaName.isNotEmpty) {
      input['areaName'] = areaName;
    }
    if (mediaIds != null && mediaIds.isNotEmpty) {
      input['mediaIds'] = mediaIds;
    }
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(createRescuePostMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['createRescuePost'];
  }

  Future<Map<String, dynamic>?> createLostPost({
    required String title,
    required String description,
    required double latitude,
    required double longitude,
    String? areaName,
    required String urgency,
    required String reportType,
    required String species,
    String? breed,
    String? colorAndMarkings,
    bool? hasCollarWithIdentificationTag,
    String? circumstances,
    String? petName,
    String? dateLastSeen,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'title': title,
      'description': description,
      'coordinates': {'latitude': latitude, 'longitude': longitude},
      'urgency': urgency,
      'reportType': reportType,
      'species': species,
    };
    if (areaName != null && areaName.isNotEmpty) input['areaName'] = areaName;
    if (breed != null && breed.isNotEmpty) input['breed'] = breed;
    if (colorAndMarkings != null && colorAndMarkings.isNotEmpty) input['colorAndMarkings'] = colorAndMarkings;
    if (hasCollarWithIdentificationTag != null) {
      input['hasCollarWithIdentificationTag'] = hasCollarWithIdentificationTag;
    }
    if (circumstances != null && circumstances.isNotEmpty) input['circumstances'] = circumstances;
    if (petName != null && petName.isNotEmpty) input['petName'] = petName;
    if (dateLastSeen != null && dateLastSeen.isNotEmpty) input['dateLastSeen'] = dateLastSeen;
    if (mediaIds != null && mediaIds.isNotEmpty) input['mediaIds'] = mediaIds;

    final result = await client.value.mutate(
      MutationOptions(
        document: gql(createLostPostMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['createLostPost'];
  }

  Future<Map<String, dynamic>?> createAdoptionPost({
    required String title,
    required String description,
    required double latitude,
    required double longitude,
    String? areaName,
    required String petName,
    required String species,
    String? breed,
    int? ageValue,
    String? ageUnit,
    required String gender,
    required bool vaccinated,
    required bool neutered,
    String? healthNotes,
    List<String>? personalityTags,
    String? spaceRequirement,
    required bool priorPetExperienceRequired,
    String? additionalRequirements,
    String? currentlyWith,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'title': title,
      'description': description,
      'coordinates': {'latitude': latitude, 'longitude': longitude},
      'petName': petName,
      'species': species,
      'gender': gender,
      'vaccinated': vaccinated,
      'neutered': neutered,
      'priorPetExperienceRequired': priorPetExperienceRequired,
    };
    if (areaName != null && areaName.isNotEmpty) input['areaName'] = areaName;
    if (breed != null && breed.isNotEmpty) input['breed'] = breed;
    if (ageValue != null && ageUnit != null) {
      input['ageValue'] = ageValue;
      input['ageUnit'] = ageUnit;
    }
    if (healthNotes != null && healthNotes.isNotEmpty) input['healthNotes'] = healthNotes;
    if (personalityTags != null && personalityTags.isNotEmpty) input['personalityTags'] = personalityTags;
    if (spaceRequirement != null) input['spaceRequirement'] = spaceRequirement;
    if (additionalRequirements != null && additionalRequirements.isNotEmpty) {
      input['additionalRequirements'] = additionalRequirements;
    }
    if (currentlyWith != null && currentlyWith.isNotEmpty) input['currentlyWith'] = currentlyWith;
    if (mediaIds != null && mediaIds.isNotEmpty) input['mediaIds'] = mediaIds;

    final result = await client.value.mutate(
      MutationOptions(
        document: gql(createAdoptionPostMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['createAdoptionPost'];
  }

  Future<Map<String, dynamic>?> createProductPost({
    required String title,
    required String description,
    required double latitude,
    required double longitude,
    String? areaName,
    required String category,
    required String condition,
    double? priceAmount,
    String priceCurrency = 'EGP',
    required bool isFree,
    bool openToOffers = false,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'title': title,
      'description': description,
      'coordinates': {'latitude': latitude, 'longitude': longitude},
      'category': category,
      'condition': condition,
      'priceCurrency': priceCurrency,
      'isFree': isFree,
      'openToOffers': openToOffers,
    };
    if (areaName != null && areaName.isNotEmpty) {
      input['areaName'] = areaName;
    }
    if (!isFree && priceAmount != null) {
      input['priceAmount'] = priceAmount;
    }
    if (mediaIds != null && mediaIds.isNotEmpty) {
      input['mediaIds'] = mediaIds;
    }
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(createProductPostMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['createProductPost'];
  }

  /// Runs a feed query and parses its PostConnection into a (posts,
  /// errorMessage) tuple — shared by fetchHomeFeed/fetchHelpFeed/fetchMarketFeed.
  Future<(List<FeedPost> posts, String? errorMessage)> _runFeedQuery(
    String document,
    String feedFieldName,
    Map<String, dynamic> variables,
  ) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(document),
        variables: variables,
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<FeedPost>[], _serverErrorMessage(result.exception));
    }
    final edges = result.data?[feedFieldName]?['edges'] as List<dynamic>? ?? [];
    final posts = edges.map((e) => FeedPost.fromEdgeJson(e as Map<String, dynamic>)).toList();
    return (posts, null);
  }

  /// Fetches the combined home feed (RESCUE, LOST, ADOPTION, PRODUCT posts
  /// mixed together, newest first). [governorate] is required by the
  /// backend; pass the viewer's home city governorate.
  Future<(List<FeedPost> posts, String? errorMessage)> fetchHomeFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    int first = 20,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'first': first,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(homeFeedQuery, 'homeFeed', variables);
  }

  /// Fetches the Help feed — RESCUE and LOST posts only, urgency-sorted
  /// (CRITICAL first). [governorate] is required by the backend.
  Future<(List<FeedPost> posts, String? errorMessage)> fetchHelpFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    int first = 20,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'first': first,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(helpFeedQuery, 'helpFeed', variables);
  }

  /// Fetches the Adopt feed — ADOPTION posts only. [governorate] is
  /// required by the backend. [sort] is 'HOT' or 'NEWEST'; defaults to
  /// 'HOT' server-side.
  Future<(List<FeedPost> posts, String? errorMessage)> fetchAdoptFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    String? sort,
    int first = 20,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'sort': sort,
      'first': first,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(adoptFeedQuery, 'adoptFeed', variables);
  }

  /// Fetches the Market feed — PRODUCT posts only. [governorate] is
  /// required by the backend. [category] filters server-side when given
  /// (must be a raw ProductCategory enum value, e.g. 'CARE'). [sort] is
  /// 'HOT' or 'NEWEST'; defaults to 'HOT' server-side.
  Future<(List<FeedPost> posts, String? errorMessage)> fetchMarketFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    String? category,
    String? sort,
    int first = 20,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'category': category,
      'sort': sort,
      'first': first,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(marketFeedQuery, 'marketFeed', variables);
  }

  /// Toggles upvote on a post. Returns the updated (count, isUpvotedByMe)
  /// on success, or (null, null, message) on failure.
  Future<(int? upvoteCount, bool? isUpvotedByMe, String? errorMessage)> toggleUpvote(String postId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(toggleUpvoteMutation), variables: {'postId': postId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, null, _serverErrorMessage(result.exception));
    }
    final data = result.data?['toggleUpvote'] as Map<String, dynamic>?;
    return (data?['upvoteCount'] as int?, data?['isUpvotedByMe'] as bool?, null);
  }

  /// Toggles save/bookmark on a post. Returns the updated (count,
  /// isSavedByMe) on success, or (null, null, message) on failure.
  Future<(int? saveCount, bool? isSavedByMe, String? errorMessage)> toggleSave(String postId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(toggleSaveMutation), variables: {'postId': postId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, null, _serverErrorMessage(result.exception));
    }
    final data = result.data?['toggleSave'] as Map<String, dynamic>?;
    return (data?['saveCount'] as int?, data?['isSavedByMe'] as bool?, null);
  }

  /// Updates a post's lifecycle status (e.g. ACTIVE -> RESOLVED). Only the
  /// post creator may do this.
  Future<(bool success, String? errorMessage)> updatePostStatus({required String postId, required String status}) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(updatePostStatusMutation), variables: {'postId': postId, 'status': status}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (true, null);
  }

  /// Soft-deletes a post (sets status to REMOVED). Only the post creator
  /// may do this.
  Future<(bool success, String? errorMessage)> deletePost(String postId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(deletePostMutation), variables: {'postId': postId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (true, null);
  }

  /// Records a view on a post. Fire-and-forget — failures are swallowed
  /// since this is a background analytics signal, not user-facing.
  Future<void> recordView(String postId) async {
    try {
      await client.value.mutate(
        MutationOptions(document: gql(recordViewMutation), variables: {'postId': postId}),
      );
    } catch (e) {
      if (kDebugMode) debugPrint('recordView failed: $e');
    }
  }

  /// Fetches the base post fields (creator, media, coordinates, counts)
  /// for a detail screen. Callers should follow up with the matching
  /// extension-type fetch based on [PostDetail.postType].
  Future<(PostDetail? post, String? errorMessage)> fetchPostDetail(String id) async {
    final result = await client.value.query(
      QueryOptions(document: gql(postDetailQuery), variables: {'id': id}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['post'] as Map<String, dynamic>?;
    if (node == null) return (null, null);
    return (PostDetail.fromJson(node), null);
  }

  Future<(RescuePostExtension? ext, String? errorMessage)> fetchRescuePostDetail(String postId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(rescuePostDetailQuery), variables: {'postId': postId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['rescuePostDetail'] as Map<String, dynamic>?;
    return (node != null ? RescuePostExtension.fromJson(node) : null, null);
  }

  Future<(LostPostExtension? ext, String? errorMessage)> fetchLostPostDetail(String postId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(lostPostDetailQuery), variables: {'postId': postId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['lostPostDetail'] as Map<String, dynamic>?;
    return (node != null ? LostPostExtension.fromJson(node) : null, null);
  }

  Future<(AdoptionPostExtension? ext, String? errorMessage)> fetchAdoptionPostDetail(String postId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(adoptionPostDetailQuery), variables: {'postId': postId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['adoptionPostDetail'] as Map<String, dynamic>?;
    return (node != null ? AdoptionPostExtension.fromJson(node) : null, null);
  }

  Future<(ProductPostExtension? ext, String? errorMessage)> fetchProductPostDetail(String postId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(productPostDetailQuery), variables: {'postId': postId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['productPostDetail'] as Map<String, dynamic>?;
    return (node != null ? ProductPostExtension.fromJson(node) : null, null);
  }

  // ─── Contact requests ─────────────────────────────────────────────────

  /// Contact requests I've SENT. Optionally filter by [postId]/[status].
  Future<(List<ContactRequest> requests, String? errorMessage)> fetchMyContactRequests({
    String? postId,
    String? status,
    int first = 20,
  }) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(myContactRequestsQuery),
        variables: {'postId': postId, 'status': status, 'first': first},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<ContactRequest>[], _serverErrorMessage(result.exception));
    }
    final edges = result.data?['myContactRequests']?['edges'] as List<dynamic>? ?? [];
    return (edges.map((e) => ContactRequest.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList(), null);
  }

  /// Contact requests received on my [postId]. Owner-only.
  Future<(List<ContactRequest> requests, String? errorMessage)> fetchPostContactRequests({
    required String postId,
    String? status,
    int first = 20,
  }) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(postContactRequestsQuery),
        variables: {'postId': postId, 'status': status, 'first': first},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<ContactRequest>[], _serverErrorMessage(result.exception));
    }
    final edges = result.data?['postContactRequests']?['edges'] as List<dynamic>? ?? [];
    return (edges.map((e) => ContactRequest.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList(), null);
  }

  /// Re-fetches the wa.me link for an already-approved request I sent.
  Future<(String? link, String? errorMessage)> getWhatsAppLink(String requestId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(getWhatsAppLinkQuery), variables: {'requestId': requestId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['getWhatsAppLink'] as String?, null);
  }

  /// Decrypted WhatsApp link for a PRODUCT post's seller — no approval gate.
  Future<(String? link, String? errorMessage)> getProductSellerContact(String postId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(getProductSellerContactQuery), variables: {'postId': postId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['getProductSellerContact'] as String?, null);
  }

  /// Sends a contact request to a RESCUE/LOST/ADOPTION post's owner.
  Future<(ContactRequest? request, String? errorMessage)> requestContact({required String postId, required String message}) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(requestContactMutation), variables: {'postId': postId, 'message': message}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['requestContact'] as Map<String, dynamic>?;
    return (node != null ? ContactRequest.fromJson(node) : null, null);
  }

  Future<(ContactRequest? request, String? errorMessage)> approveContactRequest(String requestId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(approveContactRequestMutation), variables: {'requestId': requestId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['approveContactRequest'] as Map<String, dynamic>?;
    return (node != null ? ContactRequest.fromJson(node) : null, null);
  }

  Future<(ContactRequest? request, String? errorMessage)> rejectContactRequest(String requestId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(rejectContactRequestMutation), variables: {'requestId': requestId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['rejectContactRequest'] as Map<String, dynamic>?;
    return (node != null ? ContactRequest.fromJson(node) : null, null);
  }

  // ─── Adoption applications ────────────────────────────────────────────

  Future<(List<AdoptionApplication> applications, String? errorMessage)> fetchMyAdoptionApplications({int first = 20}) async {
    final result = await client.value.query(
      QueryOptions(document: gql(myAdoptionApplicationsQuery), variables: {'first': first}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<AdoptionApplication>[], _serverErrorMessage(result.exception));
    }
    final edges = result.data?['myAdoptionApplications']?['edges'] as List<dynamic>? ?? [];
    return (edges.map((e) => AdoptionApplication.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList(), null);
  }

  Future<(List<AdoptionApplication> applications, String? errorMessage)> fetchPostAdoptionApplications({
    required String postId,
    String? status,
    int first = 20,
  }) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(postAdoptionApplicationsQuery),
        variables: {'postId': postId, 'status': status, 'first': first},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<AdoptionApplication>[], _serverErrorMessage(result.exception));
    }
    final edges = result.data?['postAdoptionApplications']?['edges'] as List<dynamic>? ?? [];
    return (edges.map((e) => AdoptionApplication.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList(), null);
  }

  /// Submits the adoption questionnaire for a target ADOPTION post.
  Future<(AdoptionApplication? application, String? errorMessage)> submitAdoptionApplication(Map<String, dynamic> input) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(submitAdoptionApplicationMutation), variables: {'input': input}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['submitAdoptionApplication'] as Map<String, dynamic>?;
    return (node != null ? AdoptionApplication.fromJson(node) : null, null);
  }

  Future<(AdoptionApplication? application, String? errorMessage)> approveAdoptionApplication(String applicationId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(approveAdoptionApplicationMutation), variables: {'applicationId': applicationId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['approveAdoptionApplication'] as Map<String, dynamic>?;
    return (node != null ? AdoptionApplication.fromJson(node) : null, null);
  }

  Future<(AdoptionApplication? application, String? errorMessage)> rejectAdoptionApplication(String applicationId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(rejectAdoptionApplicationMutation), variables: {'applicationId': applicationId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['rejectAdoptionApplication'] as Map<String, dynamic>?;
    return (node != null ? AdoptionApplication.fromJson(node) : null, null);
  }

  // ─── Notifications ─────────────────────────────────────────────────────

  Future<(List<AppNotification> notifications, int unreadCount, String? errorMessage)> fetchMyNotifications({int first = 30}) async {
    final result = await client.value.query(
      QueryOptions(document: gql(myNotificationsQuery), variables: {'first': first}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<AppNotification>[], 0, _serverErrorMessage(result.exception));
    }
    final data = result.data?['myNotifications'] as Map<String, dynamic>?;
    final edges = data?['edges'] as List<dynamic>? ?? [];
    final notifications = edges.map((e) => AppNotification.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList();
    return (notifications, data?['unreadCount'] as int? ?? 0, null);
  }

  Future<(int? count, String? errorMessage)> fetchMyUnreadNotificationCount() async {
    final result = await client.value.query(
      QueryOptions(document: gql(myUnreadNotificationCountQuery), fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['myUnreadNotificationCount'] as int?, null);
  }

  Future<(bool success, String? errorMessage)> markNotificationRead(String notificationId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(markNotificationReadMutation), variables: {'notificationId': notificationId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (true, null);
  }

  Future<(int? count, String? errorMessage)> markAllNotificationsRead() async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(markAllNotificationsReadMutation)),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['markAllNotificationsRead'] as int?, null);
  }
}
