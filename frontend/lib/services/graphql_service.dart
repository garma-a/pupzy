import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:graphql_flutter/graphql_flutter.dart';

import '../config/api_config.dart';
import '../models/account_deletion.dart';
import '../models/adoption_application.dart';
import '../models/app_notification.dart';
import '../models/blocked_user.dart';
import '../models/comment.dart';
import '../models/contact_request.dart';
import '../models/feed_post.dart';
import '../models/mating_detail.dart';
import '../models/post_detail.dart';
import '../models/safety.dart';
import '../models/terms_info.dart';
import '../models/vet_clinic.dart';
import '../screens/account_deletion_in_progress_screen.dart';
import '../screens/account_suspended_screen.dart';
import '../utils/navigation.dart';
import 'auth_service.dart';

class GraphQLService {
  // The GraphQL package defaults to five seconds, which is too short for the
  // first request after an emulator/backend restart. In that case Firebase
  // sign-in succeeds, but loading the profile or city list times out before
  // the local connection is ready.
  static const Duration _requestTimeout = Duration(seconds: 30);

  late final ValueNotifier<GraphQLClient> client;
  final AuthService _authService;

  /// Guards against acting on a ban/deletion lockout more than once —
  /// once a request has tripped it, every other in-flight/queued request
  /// will hit the same rejection until sign-out completes; only the first
  /// should force navigation and sign-out.
  bool _lockoutHandled = false;

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
        queryRequestTimeout: _requestTimeout,
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

  static const String nearbyVetClinicsQuery = r'''
    query NearbyVetClinics($cityId: ID!) {
      nearbyVetClinics(cityId: $cityId) {
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
        commentCount
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
    query HomeFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$search: String, \$first: Int, \$after: String) {
      homeFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, search: \$search, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String helpFeedQuery = '''
    query HelpFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$search: String, \$first: Int, \$after: String) {
      helpFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, search: \$search, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String adoptFeedQuery = '''
    query AdoptFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$sort: AdoptFeedSort, \$search: String, \$first: Int, \$after: String) {
      adoptFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, sort: \$sort, search: \$search, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String marketFeedQuery = '''
    query MarketFeed(\$governorate: String!, \$cityId: ID, \$viewerLocation: ViewerLocationInput, \$radiusKm: Float, \$category: ProductCategory, \$sort: MarketFeedSort, \$search: String, \$first: Int, \$after: String) {
      marketFeed(governorate: \$governorate, cityId: \$cityId, viewerLocation: \$viewerLocation, radiusKm: \$radiusKm, category: \$category, sort: \$sort, search: \$search, first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  /// Field selection for MatingPostConnection edges — same node shape as
  /// _feedConnectionFields, minus `distanceKm` (MatingPostEdge has no
  /// distance field; mating listings aren't filtered by radius).
  static const String _matingConnectionFields = r'''
    edges {
      cursor
      node {
        id
        postType
        title
        description
        status
        areaName
        marketCategory
        upvoteCount
        saveCount
        viewCount
        commentCount
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

  static final String matingFeedQuery = '''
    query MatingFeed(\$filter: MatingFeedFilter, \$search: String, \$first: Int, \$after: String) {
      matingFeed(filter: \$filter, search: \$search, first: \$first, after: \$after) {
        $_matingConnectionFields
      }
    }
  ''';

  static const String matingPostDetailQuery = r'''
    query MatingPostDetail($postId: ID!) {
      matingPostDetail(postId: $postId) {
        petName
        species
        breed
        gender
        ageValue
        ageUnit
        isPurebred
        hasPedigreeCertificate
        vaccinated
        dewormed
        termsSummary
        matingConditions
      }
    }
  ''';

  static const String createMatingPostMutation = r'''
    mutation CreateMatingPost($input: CreateMatingPostInput!) {
      createMatingPost(input: $input) {
        id
        title
      }
    }
  ''';

  static final String mySavedPostsQuery = '''
    query MySavedPosts(\$first: Int, \$after: String) {
      mySavedPosts(first: \$first, after: \$after) {
        $_feedConnectionFields
      }
    }
  ''';

  static final String myPostsQuery = '''
    query MyPosts(\$postType: PostType!, \$first: Int, \$after: String) {
      myPosts(postType: \$postType, first: \$first, after: \$after) {
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
        commentCount
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
      if (result.exception != null) _checkForAccountLockout(result.exception!);
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
      if (result.exception != null) _checkForAccountLockout(result.exception!);
      return [];
    }
    final list = result.data?['cities'] as List<dynamic>?;
    return list?.cast<Map<String, dynamic>>() ?? [];
  }

  /// Fetches up to 15 vet clinics nearest to a city's center, sorted by
  /// distance — used by the Home "Vets near you" sheet and its "View all
  /// vets" screen.
  Future<(List<VetClinic> clinics, String? errorMessage)> fetchNearbyVetClinics({required String cityId}) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(nearbyVetClinicsQuery),
        variables: {'cityId': cityId},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<VetClinic>[], _serverErrorMessage(result.exception));
    }
    final list = result.data?['nearbyVetClinics'] as List<dynamic>? ?? [];
    final clinics = list.map((c) => VetClinic.fromJson(c as Map<String, dynamic>)).toList();
    return (clinics, null);
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
    _checkForAccountLockout(exception);
    if (exception.graphqlErrors.isNotEmpty) {
      return exception.graphqlErrors.first.message;
    }
    return null;
  }

  /// Detects the two lockout rejections `FirebaseAuthGuard` throws on
  /// every authenticated request — a ban ("Your account has been
  /// suspended.") or an accepted account-deletion ("ACCOUNT_DELETED") —
  /// and, the first time either is seen this session, force-signs-out and
  /// replaces the whole navigation stack with a dedicated explanation
  /// screen, rather than letting it surface as a generic, confusing error
  /// toast wherever the user happened to be. Ban messages are matched by
  /// text (the error code, FORBIDDEN, is shared with unrelated permission
  /// checks); ACCOUNT_DELETED is matched by its distinct code.
  void _checkForAccountLockout(OperationException exception) {
    if (_lockoutHandled) return;
    final isBanned = exception.graphqlErrors.any(
      (e) => e.message.toLowerCase().contains('account has been suspended'),
    );
    final isDeleted = exception.graphqlErrors.any((e) => e.message.contains('ACCOUNT_DELETED'));
    if (!isBanned && !isDeleted) return;
    _lockoutHandled = true;
    _authService.signOut();
    rootNavigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => isDeleted ? const AccountDeletionInProgressScreen() : const AccountSuspendedScreen(),
      ),
      (route) => false,
    );
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
    String? languagePreference,
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
    if (languagePreference != null) {
      input['languagePreference'] = languagePreference;
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
      if (result.exception != null) _checkForAccountLockout(result.exception!);
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
      if (result.exception != null) _checkForAccountLockout(result.exception!);
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
      if (result.exception != null) _checkForAccountLockout(result.exception!);
      return null;
    }
    return result.data?['requestMediaUploadUrl'];
  }

  Future<(Map<String, dynamic>? data, String? errorMessage)> createRescuePost({
    required String title,
    required String description,
    required double latitude,
    required double longitude,
    String? areaName,
    required String species,
    required String conditionSummary,
    required String reporterRole,
    required bool isLifeThreatening,
    required bool hasVisibleSeriousInjury,
    required bool isInDangerousLocation,
    required bool canAnimalMoveOrEscape,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'title': title,
      'description': description,
      'coordinates': {'latitude': latitude, 'longitude': longitude},
      'species': species,
      'conditionSummary': conditionSummary,
      'reporterRole': reporterRole,
      'isLifeThreatening': isLifeThreatening,
      'hasVisibleSeriousInjury': hasVisibleSeriousInjury,
      'isInDangerousLocation': isInDangerousLocation,
      'canAnimalMoveOrEscape': canAnimalMoveOrEscape,
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
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['createRescuePost'] as Map<String, dynamic>?, null);
  }

  Future<(Map<String, dynamic>? data, String? errorMessage)> createLostPost({
    required String title,
    required String description,
    required double latitude,
    required double longitude,
    String? areaName,
    required String reportType,
    required String species,
    String? breed,
    String? colorAndMarkings,
    bool? hasCollarWithIdentificationTag,
    String? circumstances,
    // LOST_PET-only — omit entirely for FOUND_STRAY.
    String? petName,
    String? dateLastSeen,
    // Required for LOST_PET reports — used by the backend to compute
    // posts.urgency server-side. Must be omitted for FOUND_STRAY.
    bool? hasMedicalNeeds,
    bool? isElderlyOrVeryYoung,
    bool? lastSeenNearHazard,
    // FOUND_STRAY-only — required for FOUND_STRAY, must be omitted for LOST_PET.
    String? currentCondition,
    bool? isCurrentlySafeWithReporter,
    String? dateFound,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'title': title,
      'description': description,
      'coordinates': {'latitude': latitude, 'longitude': longitude},
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
    if (hasMedicalNeeds != null) input['hasMedicalNeeds'] = hasMedicalNeeds;
    if (isElderlyOrVeryYoung != null) input['isElderlyOrVeryYoung'] = isElderlyOrVeryYoung;
    if (lastSeenNearHazard != null) input['lastSeenNearHazard'] = lastSeenNearHazard;
    if (currentCondition != null) input['currentCondition'] = currentCondition;
    if (isCurrentlySafeWithReporter != null) input['isCurrentlySafeWithReporter'] = isCurrentlySafeWithReporter;
    if (dateFound != null && dateFound.isNotEmpty) input['dateFound'] = dateFound;
    if (mediaIds != null && mediaIds.isNotEmpty) input['mediaIds'] = mediaIds;

    final result = await client.value.mutate(
      MutationOptions(
        document: gql(createLostPostMutation),
        variables: {'input': input},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['createLostPost'] as Map<String, dynamic>?, null);
  }

  Future<(Map<String, dynamic>? data, String? errorMessage)> createAdoptionPost({
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
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['createAdoptionPost'] as Map<String, dynamic>?, null);
  }

  Future<(Map<String, dynamic>? data, String? errorMessage)> createProductPost({
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
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['createProductPost'] as Map<String, dynamic>?, null);
  }

  /// Runs a feed query and parses its PostConnection into a (posts,
  /// endCursor, hasNextPage, errorMessage) tuple — shared by
  /// fetchHomeFeed/fetchHelpFeed/fetchAdoptFeed/fetchMarketFeed.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> _runFeedQuery(
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
      return (<FeedPost>[], null, false, _serverErrorMessage(result.exception));
    }
    final connection = result.data?[feedFieldName] as Map<String, dynamic>?;
    final edges = connection?['edges'] as List<dynamic>? ?? [];
    final posts = edges.map((e) => FeedPost.fromEdgeJson(e as Map<String, dynamic>)).toList();
    final pageInfo = connection?['pageInfo'] as Map<String, dynamic>?;
    final endCursor = pageInfo?['endCursor'] as String?;
    final hasNextPage = pageInfo?['hasNextPage'] as bool? ?? false;
    return (posts, endCursor, hasNextPage, null);
  }

  /// Fetches the combined home feed (RESCUE, LOST, ADOPTION, PRODUCT posts
  /// mixed together, newest first). [governorate] is required by the
  /// backend; pass the viewer's home city governorate.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchHomeFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    String? search,
    int first = 20,
    String? after,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'search': search,
      'first': first,
      'after': after,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(homeFeedQuery, 'homeFeed', variables);
  }

  /// Fetches the Help feed — RESCUE and LOST posts only, urgency-sorted
  /// (CRITICAL first). [governorate] is required by the backend.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchHelpFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    String? search,
    int first = 20,
    String? after,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'search': search,
      'first': first,
      'after': after,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(helpFeedQuery, 'helpFeed', variables);
  }

  /// Fetches the Adopt feed — ADOPTION posts only. [governorate] is
  /// required by the backend. [sort] is 'HOT' or 'NEWEST'; defaults to
  /// 'HOT' server-side.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchAdoptFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    String? sort,
    String? search,
    int first = 20,
    String? after,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'sort': sort,
      'search': search,
      'first': first,
      'after': after,
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
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchMarketFeed({
    required String governorate,
    String? cityId,
    double? latitude,
    double? longitude,
    double? radiusKm,
    String? category,
    String? sort,
    String? search,
    int first = 20,
    String? after,
  }) {
    final variables = <String, dynamic>{
      'governorate': governorate,
      'cityId': cityId,
      'radiusKm': radiusKm,
      'category': category,
      'sort': sort,
      'search': search,
      'first': first,
      'after': after,
    };
    if (latitude != null && longitude != null) {
      variables['viewerLocation'] = {'latitude': latitude, 'longitude': longitude};
    }
    return _runFeedQuery(marketFeedQuery, 'marketFeed', variables);
  }

  /// Fetches the Mating feed — MATING posts only, newest first. Unlike the
  /// other feeds this isn't governorate/radius-scoped; pass [cityId] to
  /// narrow to one city, or omit it to browse mating listings everywhere.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchMatingFeed({
    String? cityId,
    String? species,
    String? gender,
    String? breed,
    String? search,
    int first = 20,
    String? after,
  }) {
    final filter = <String, dynamic>{};
    if (cityId != null) filter['cityId'] = cityId;
    if (species != null) filter['species'] = species;
    if (gender != null) filter['gender'] = gender;
    if (breed != null) filter['breed'] = breed;
    final variables = <String, dynamic>{
      'filter': filter.isEmpty ? null : filter,
      'search': search,
      'first': first,
      'after': after,
    };
    return _runFeedQuery(matingFeedQuery, 'matingFeed', variables);
  }

  /// Fetches posts the current viewer has saved/bookmarked, newest save first.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchMySavedPosts({
    int first = 20,
    String? after,
  }) {
    return _runFeedQuery(mySavedPostsQuery, 'mySavedPosts', {'first': first, 'after': after});
  }

  /// Fetches posts the current viewer created, scoped to one section
  /// (postType), newest first. [postType] must be one of RESCUE, LOST,
  /// ADOPTION, PRODUCT.
  Future<(List<FeedPost> posts, String? endCursor, bool hasNextPage, String? errorMessage)> fetchMyPosts({
    required String postType,
    int first = 20,
    String? after,
  }) {
    return _runFeedQuery(myPostsQuery, 'myPosts', {'postType': postType, 'first': first, 'after': after});
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

  Future<(MatingDetails? ext, String? errorMessage)> fetchMatingPostDetail(String postId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(matingPostDetailQuery), variables: {'postId': postId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['matingPostDetail'] as Map<String, dynamic>?;
    return (node != null ? MatingDetails.fromJson(node) : null, null);
  }

  Future<(Map<String, dynamic>? data, String? errorMessage)> createMatingPost({
    required String cityId,
    required String petName,
    required String species,
    required String breed,
    required String gender,
    required int ageValue,
    required String ageUnit,
    required bool isPurebred,
    bool? hasPedigreeCertificate,
    bool? vaccinated,
    bool? dewormed,
    String? termsSummary,
    String? matingConditions,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'petName': petName,
      'species': species,
      'breed': breed,
      'gender': gender,
      'ageValue': ageValue,
      'ageUnit': ageUnit,
      'isPurebred': isPurebred,
      'cityId': cityId,
      'mediaIds': mediaIds ?? [],
    };
    if (hasPedigreeCertificate != null) input['hasPedigreeCertificate'] = hasPedigreeCertificate;
    if (vaccinated != null) input['vaccinated'] = vaccinated;
    if (dewormed != null) input['dewormed'] = dewormed;
    if (termsSummary != null && termsSummary.isNotEmpty) input['termsSummary'] = termsSummary;
    if (matingConditions != null && matingConditions.isNotEmpty) input['matingConditions'] = matingConditions;

    final result = await client.value.mutate(
      MutationOptions(document: gql(createMatingPostMutation), variables: {'input': input}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['createMatingPost'] as Map<String, dynamic>?, null);
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

  Future<NotificationPage> fetchMyNotifications({int first = 30, String? after}) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(myNotificationsQuery),
        variables: {'first': first, 'after': after},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return NotificationPage(errorMessage: _serverErrorMessage(result.exception));
    }
    final data = result.data?['myNotifications'] as Map<String, dynamic>?;
    final edges = data?['edges'] as List<dynamic>? ?? [];
    final pageInfo = data?['pageInfo'] as Map<String, dynamic>?;
    return NotificationPage(
      notifications: edges.map((e) => AppNotification.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList(),
      unreadCount: data?['unreadCount'] as int? ?? 0,
      endCursor: pageInfo?['endCursor'] as String?,
      hasNextPage: pageInfo?['hasNextPage'] as bool? ?? false,
    );
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

  // ─── Account deletion ─────────────────────────────────────────

  static const String _accountDeletionPayloadFields = r'''
    status
    deletionId
    progressToken
    message
    acceptedAt
    completedAt
  ''';

  static final String deleteMyAccountMutation = '''
    mutation DeleteMyAccount(\$input: DeleteMyAccountInput!) {
      deleteMyAccount(input: \$input) { $_accountDeletionPayloadFields }
    }
  ''';

  static final String accountDeletionProgressQuery = '''
    query AccountDeletionProgress(\$deletionId: ID!, \$progressToken: String!) {
      accountDeletionProgress(deletionId: \$deletionId, progressToken: \$progressToken) { $_accountDeletionPayloadFields }
    }
  ''';

  /// Permanently deletes the signed-in user's account. The backend only
  /// accepts this within 5 minutes of the user's last authentication, so
  /// the caller must re-authenticate (see AuthService.reauthenticateWith*)
  /// immediately before calling this — not at some earlier point in the
  /// session. [progressToken], if supplied, lets the caller look up
  /// progress later via [fetchAccountDeletionProgress] even if this
  /// response never arrives (e.g. the app is killed mid-request);
  /// generate one with generateClientRequestId() and hang onto it until
  /// you see a successful result.
  Future<(AccountDeletionPayload? payload, String? errorMessage)> deleteMyAccount({
    required bool confirm,
    String? progressToken,
  }) async {
    final input = <String, dynamic>{'confirm': confirm};
    if (progressToken != null) input['progressToken'] = progressToken;
    final result = await client.value.mutate(
      MutationOptions(document: gql(deleteMyAccountMutation), variables: {'input': input}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['deleteMyAccount'] as Map<String, dynamic>?;
    return (node != null ? AccountDeletionPayload.fromJson(node) : null, null);
  }

  /// Public, unauthenticated status check for an in-progress deletion —
  /// works even though the account it refers to may already be locked out
  /// of ordinary access. Requires the exact (deletionId, progressToken)
  /// pair returned by [deleteMyAccount].
  Future<(AccountDeletionPayload? payload, String? errorMessage)> fetchAccountDeletionProgress({
    required String deletionId,
    required String progressToken,
  }) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(accountDeletionProgressQuery),
        variables: {'deletionId': deletionId, 'progressToken': progressToken},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['accountDeletionProgress'] as Map<String, dynamic>?;
    return (node != null ? AccountDeletionPayload.fromJson(node) : null, null);
  }

  // ─── Comments ─────────────────────────────────────────────────────────

  /// Shared field selection for a Comment (a Reply is the same type),
  /// reused by the comments/replies queries and every mutation that
  /// returns a Comment.
  static const String _commentFields = r'''
    id
    postId
    parentId
    author {
      id
      fullName
      fullNameArabic
      profilePictureUrl
    }
    text
    status
    replyCount
    boostCount
    isBoostedByMe
    isPinned
    media {
      id
      publicUrl
      width
      height
      displayOrder
    }
    createdAt
    updatedAt
  ''';

  static final String commentsQuery = '''
    query Comments(\$postId: ID!, \$sort: CommentSort, \$first: Int, \$after: String) {
      comments(postId: \$postId, sort: \$sort, first: \$first, after: \$after) {
        edges {
          cursor
          node {
            $_commentFields
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  ''';

  static final String repliesQuery = '''
    query Replies(\$commentId: ID!, \$first: Int, \$after: String) {
      replies(commentId: \$commentId, first: \$first, after: \$after) {
        edges {
          cursor
          node {
            $_commentFields
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  ''';

  static const String requestCommentImageUploadUrlMutation = r'''
    mutation RequestCommentImageUploadUrl($input: RequestCommentImageUploadInput!) {
      requestCommentImageUploadUrl(input: $input) {
        mediaId
        uploadUrl
        expiresAt
        maxSizeBytes
        maxWidth
        maxHeight
        allowedContentType
      }
    }
  ''';

  static final String createCommentMutation = '''
    mutation CreateComment(\$input: CreateCommentInput!) {
      createComment(input: \$input) {
        $_commentFields
      }
    }
  ''';

  static final String createReplyMutation = '''
    mutation CreateReply(\$input: CreateReplyInput!) {
      createReply(input: \$input) {
        $_commentFields
      }
    }
  ''';

  static const String deleteCommentMutation = r'''
    mutation DeleteComment($id: ID!) {
      deleteComment(id: $id)
    }
  ''';

  static const String toggleCommentBoostMutation = r'''
    mutation ToggleCommentBoost($commentId: ID!) {
      toggleCommentBoost(commentId: $commentId) {
        commentId
        isBoostedByMe
        boostedByMe
        boostCount
      }
    }
  ''';

  static final String pinCommentMutation = '''
    mutation PinComment(\$commentId: ID!) {
      pinComment(commentId: \$commentId) {
        $_commentFields
      }
    }
  ''';

  static const String unpinCommentMutation = r'''
    mutation UnpinComment($postId: ID!) {
      unpinComment(postId: $postId)
    }
  ''';

  static const String reportCommentMutation = r'''
    mutation ReportComment($input: ReportCommentInput!) {
      reportComment(input: $input)
    }
  ''';

  /// Runs a comments/replies connection query and parses it into a (list,
  /// endCursor, hasNextPage, errorMessage) tuple — shared by [fetchComments]
  /// and [fetchReplies] since both return the same CommentConnection shape.
  Future<(List<Comment> comments, String? endCursor, bool hasNextPage, String? errorMessage)> _runCommentsQuery(
    String document,
    String fieldName,
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
      return (<Comment>[], null, false, _serverErrorMessage(result.exception));
    }
    final connection = result.data?[fieldName] as Map<String, dynamic>?;
    final edges = connection?['edges'] as List<dynamic>? ?? [];
    final comments = edges.map((e) => Comment.fromJson((e as Map<String, dynamic>)['node'] as Map<String, dynamic>)).toList();
    final pageInfo = connection?['pageInfo'] as Map<String, dynamic>?;
    final endCursor = pageInfo?['endCursor'] as String?;
    final hasNextPage = pageInfo?['hasNextPage'] as bool? ?? false;
    return (comments, endCursor, hasNextPage, null);
  }

  /// Fetches top-level comments for a post, sorted by [sort] ('TOP' or
  /// 'NEWEST').
  Future<(List<Comment> comments, String? endCursor, bool hasNextPage, String? errorMessage)> fetchComments({
    required String postId,
    required String sort,
    int first = 20,
    String? after,
  }) {
    return _runCommentsQuery(commentsQuery, 'comments', {
      'postId': postId,
      'sort': sort,
      'first': first,
      'after': after,
    });
  }

  /// Fetches replies beneath a top-level comment, oldest first.
  Future<(List<Comment> replies, String? endCursor, bool hasNextPage, String? errorMessage)> fetchReplies({
    required String commentId,
    int first = 20,
    String? after,
  }) {
    return _runCommentsQuery(repliesQuery, 'replies', {
      'commentId': commentId,
      'first': first,
      'after': after,
    });
  }

  /// Requests a presigned upload ticket for a comment image. Returns the
  /// raw ticket map (mediaId/uploadUrl/...) — the caller PUTs the image
  /// bytes to `uploadUrl` directly, same pattern as post media uploads.
  Future<(Map<String, dynamic>? ticket, String? errorMessage)> requestCommentImageUploadUrl({
    required String contentType,
    required int fileSizeBytes,
  }) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(requestCommentImageUploadUrlMutation),
        variables: {
          'input': {'contentType': contentType, 'fileSizeBytes': fileSizeBytes},
        },
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['requestCommentImageUploadUrl'] as Map<String, dynamic>?, null);
  }

  Future<(Comment? comment, String? errorMessage)> createComment({
    required String clientRequestId,
    required String postId,
    required String text,
    List<String>? mediaIds,
  }) async {
    final input = <String, dynamic>{
      'clientRequestId': clientRequestId,
      'postId': postId,
      'text': text,
    };
    if (mediaIds != null && mediaIds.isNotEmpty) input['mediaIds'] = mediaIds;
    final result = await client.value.mutate(
      MutationOptions(document: gql(createCommentMutation), variables: {'input': input}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['createComment'] as Map<String, dynamic>?;
    return (node != null ? Comment.fromJson(node) : null, null);
  }

  Future<(Comment? reply, String? errorMessage)> createReply({
    required String clientRequestId,
    required String commentId,
    required String text,
  }) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(createReplyMutation),
        variables: {
          'input': {'clientRequestId': clientRequestId, 'commentId': commentId, 'text': text},
        },
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['createReply'] as Map<String, dynamic>?;
    return (node != null ? Comment.fromJson(node) : null, null);
  }

  Future<(bool success, String? errorMessage)> deleteComment(String id) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(deleteCommentMutation), variables: {'id': id}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (result.data?['deleteComment'] as bool? ?? false, null);
  }

  /// Toggles boost on a comment/reply. Returns the updated (count,
  /// isBoostedByMe) on success, or (null, null, message) on failure — same
  /// three-part shape as [toggleUpvote]/[toggleSave].
  Future<(int? boostCount, bool? isBoostedByMe, String? errorMessage)> toggleCommentBoost(String commentId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(toggleCommentBoostMutation), variables: {'commentId': commentId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, null, _serverErrorMessage(result.exception));
    }
    final data = result.data?['toggleCommentBoost'] as Map<String, dynamic>?;
    return (data?['boostCount'] as int?, data?['isBoostedByMe'] as bool?, null);
  }

  /// Pins a comment beneath its post. Post-owner only; atomically replaces
  /// any existing pin.
  Future<(Comment? pinned, String? errorMessage)> pinComment(String commentId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(pinCommentMutation), variables: {'commentId': commentId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    final node = result.data?['pinComment'] as Map<String, dynamic>?;
    return (node != null ? Comment.fromJson(node) : null, null);
  }

  Future<(bool success, String? errorMessage)> unpinComment(String postId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(unpinCommentMutation), variables: {'postId': postId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (result.data?['unpinComment'] as bool? ?? false, null);
  }

  // ── UGC reporting & account blocking ──────────────────────────────────────
  // Contract: backend/docs/ugc-reporting-and-account-blocking-flutter-
  // integration-contract.md. Every mutation returns Boolean!; failures carry
  // a stable `extensions.code` (POST_ALREADY_REPORTED, RATE_LIMITED, ...) that
  // callers branch on via [SafetyResult].

  static const String reportPostMutation = r'''
    mutation ReportPost($input: ReportPostInput!) {
      reportPost(input: $input)
    }
  ''';

  static const String reportUserMutation = r'''
    mutation ReportUser($input: ReportUserInput!) {
      reportUser(input: $input)
    }
  ''';

  static const String blockUserMutation = r'''
    mutation BlockUser($userId: ID!) {
      blockUser(userId: $userId)
    }
  ''';

  static const String unblockUserMutation = r'''
    mutation UnblockUser($userId: ID!) {
      unblockUser(userId: $userId)
    }
  ''';

  static const String blockedUsersQuery = r'''
    query BlockedUsers($first: Int, $after: String) {
      blockedUsers(first: $first, after: $after) {
        edges {
          node { id fullName fullNameArabic profilePictureUrl isVerified }
          blockedAt
          cursor
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  ''';

  /// The backend's stable machine-readable error code for a failed operation
  /// (`extensions.code`), or null when there is none (e.g. no response).
  String? _errorCode(OperationException? exception) {
    if (exception == null) return null;
    for (final error in exception.graphqlErrors) {
      final code = error.extensions?['code'];
      if (code is String) return code;
    }
    return null;
  }

  /// Runs a Boolean!-returning safety mutation and folds the outcome into a
  /// [SafetyResult] carrying the error code + message on failure.
  Future<SafetyResult> _runSafetyMutation(String document, String field, Map<String, dynamic> variables) async {
    final result = await client.value.mutate(MutationOptions(document: gql(document), variables: variables));
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return SafetyResult(ok: false, code: _errorCode(result.exception), message: _serverErrorMessage(result.exception));
    }
    final ok = result.data?[field] as bool? ?? false;
    return ok ? SafetyResult.success : SafetyResult(ok: false, message: null);
  }

  /// Reports a Comment or Reply. `details` is optional here (unlike
  /// [reportPost]/[reportUser], `OTHER` does not require it).
  Future<SafetyResult> reportComment({
    required String commentId,
    required String reason,
    String? details,
  }) {
    return _runSafetyMutation(reportCommentMutation, 'reportComment', {
      'input': {
        'commentId': commentId,
        'reason': reason,
        'details': ?details,
      },
    });
  }

  /// Reports a Post of any listing type. `details` is required (nonblank)
  /// when `reason` is `OTHER`, and is capped at 500 characters.
  Future<SafetyResult> reportPost({
    required String postId,
    required String reason,
    String? details,
  }) {
    return _runSafetyMutation(reportPostMutation, 'reportPost', {
      'input': {
        'postId': postId,
        'reason': reason,
        'details': ?details,
      },
    });
  }

  /// Reports another Pupzy Account. `sourceType` and `sourceId` must be
  /// supplied together (or both omitted); see the contract §6.4 for which
  /// evidence records are accepted.
  Future<SafetyResult> reportUser({
    required String userId,
    required String reason,
    String? details,
    AccountReportSource? sourceType,
    String? sourceId,
  }) {
    return _runSafetyMutation(reportUserMutation, 'reportUser', {
      'input': {
        'userId': userId,
        'reason': reason,
        'details': ?details,
        if (sourceType != null && sourceId != null) ...{
          'sourceType': sourceType.value,
          'sourceId': sourceId,
        },
      },
    });
  }

  /// Creates the caller-owned Block. Idempotent; atomically rejects pending
  /// contact requests/adoption applications between the pair server-side.
  Future<SafetyResult> blockUser(String userId) {
    return _runSafetyMutation(blockUserMutation, 'blockUser', {'userId': userId});
  }

  /// Removes the Block the caller owns. Idempotent.
  Future<SafetyResult> unblockUser(String userId) {
    return _runSafetyMutation(unblockUserMutation, 'unblockUser', {'userId': userId});
  }

  /// One page of the accounts the caller has blocked, newest first.
  Future<(List<BlockedUser> users, String? endCursor, bool hasNextPage, String? errorMessage)> fetchBlockedUsers({
    int first = 20,
    String? after,
  }) async {
    final result = await client.value.query(
      QueryOptions(
        document: gql(blockedUsersQuery),
        variables: {'first': first, 'after': ?after},
        fetchPolicy: FetchPolicy.networkOnly,
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (<BlockedUser>[], null, false, _serverErrorMessage(result.exception));
    }
    final connection = result.data?['blockedUsers'] as Map<String, dynamic>?;
    final edges = (connection?['edges'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
    final pageInfo = connection?['pageInfo'] as Map<String, dynamic>?;
    return (
      edges.map(BlockedUser.fromEdge).toList(),
      pageInfo?['endCursor'] as String?,
      pageInfo?['hasNextPage'] as bool? ?? false,
      null,
    );
  }

  // ── Approved adoption contact ───────────────────────────────────────────────

  static const String getAdoptionWhatsAppLinkQuery = r'''
    query GetAdoptionWhatsApp($applicationId: ID!) {
      getAdoptionWhatsAppLink(applicationId: $applicationId)
    }
  ''';

  /// The owner's current WhatsApp link for the caller's own APPROVED
  /// application. Call on demand (not cached long-term): the owner's phone
  /// may change. `NOT_FOUND` covers Block isolation, a removed Post or an
  /// owner with no available contact — render the neutral unavailable state.
  Future<(String? link, String? errorMessage)> getAdoptionWhatsAppLink(String applicationId) async {
    final result = await client.value.query(
      QueryOptions(document: gql(getAdoptionWhatsAppLinkQuery), variables: {'applicationId': applicationId}, fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _serverErrorMessage(result.exception));
    }
    return (result.data?['getAdoptionWhatsAppLink'] as String?, null);
  }

  // ── Versioned Terms Acceptance ──────────────────────────────────────────────

  static const String _termsInfoFields = r'''
    currentVersion termsUrl acceptedVersion acceptedAt acceptanceRequired
  ''';

  static final String termsQuery = '''
    query Terms {
      terms { $_termsInfoFields }
    }
  ''';

  static final String acceptTermsMutation = '''
    mutation AcceptTerms(\$input: AcceptTermsInput!) {
      acceptTerms(input: \$input) { $_termsInfoFields }
    }
  ''';

  /// Never gated — safe to call before checking anything else. Returns null
  /// only on a network/server failure; a deployment with no Terms configured
  /// still returns a `TermsInfo` (with null version/url).
  Future<TermsInfo?> fetchTerms() async {
    final result = await client.value.query(
      QueryOptions(document: gql(termsQuery), fetchPolicy: FetchPolicy.networkOnly),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      if (result.exception != null) _checkForAccountLockout(result.exception!);
      return null;
    }
    final node = result.data?['terms'] as Map<String, dynamic>?;
    return node != null ? TermsInfo.fromJson(node) : null;
  }

  /// Idempotent for a repeat of the same version. On `TERMS_VERSION_MISMATCH`
  /// the caller should re-read [fetchTerms] rather than retry blindly — the
  /// published version may have changed since it was last read.
  Future<(TermsInfo? info, String? errorCode, String? errorMessage)> acceptTerms(String version) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(acceptTermsMutation), variables: {'input': {'version': version}}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _errorCode(result.exception), _serverErrorMessage(result.exception));
    }
    final node = result.data?['acceptTerms'] as Map<String, dynamic>?;
    return (node != null ? TermsInfo.fromJson(node) : null, null, null);
  }

  // ── Notification language ───────────────────────────────────────────────────

  static const String updateMyLanguagePreferenceMutation = r'''
    mutation UpdateMyLanguagePreference($languagePreference: Language!) {
      updateMyLanguagePreference(languagePreference: $languagePreference) {
        id
        languagePreference
      }
    }
  ''';

  /// Synchronizes the account's explicit `ar`/`en` preference so in-app and
  /// push notification text render in that language server-side. [lang] is
  /// `'ar'` or `'en'`. Fire-and-forget from the UI's perspective: the local
  /// display language (LangProvider) already switched instantly: this just
  /// keeps the backend's copy from staying "unsynchronized" (null → English).
  Future<bool> updateMyLanguagePreference(String lang) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(updateMyLanguagePreferenceMutation), variables: {'languagePreference': lang}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      if (result.exception != null) _checkForAccountLockout(result.exception!);
      return false;
    }
    return true;
  }

  // ── Device push delivery ────────────────────────────────────────────────────

  static const String registerDeviceMutation = r'''
    mutation RegisterDevice($input: RegisterDeviceInput!) {
      registerDevice(input: $input) {
        id
        platform
      }
    }
  ''';

  static const String unregisterDeviceMutation = r'''
    mutation UnregisterDevice($token: String!) {
      unregisterDevice(token: $token)
    }
  ''';

  static const String updateMyNotificationPreferencesMutation = r'''
    mutation UpdateMyNotificationPreferences($notificationsEnabled: Boolean!) {
      updateMyNotificationPreferences(notificationsEnabled: $notificationsEnabled) {
        id
        notificationsEnabled
      }
    }
  ''';

  /// Registers/refreshes this device's FCM token for push delivery. Call on
  /// every authenticated launch and whenever the token rotates.
  Future<bool> registerDevice({required String token, required String platform}) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(registerDeviceMutation),
        variables: {'input': {'token': token, 'platform': platform}},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return false;
    }
    return true;
  }

  /// Call on sign-out so this device stops receiving push for the signed-out
  /// account. `false` is a safe, idempotent outcome (already removed, or the
  /// token was never registered here) — never treat it as an error.
  Future<bool> unregisterDevice(String token) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(unregisterDeviceMutation), variables: {'token': token}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return false;
    }
    return result.data?['unregisterDevice'] as bool? ?? false;
  }

  /// Push opt-in/out. The in-app inbox is unaffected either way.
  Future<bool> updateMyNotificationPreferences(bool notificationsEnabled) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(updateMyNotificationPreferencesMutation),
        variables: {'notificationsEnabled': notificationsEnabled},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      if (result.exception != null) _checkForAccountLockout(result.exception!);
      return false;
    }
    return true;
  }

  // ── Expiry and renewal ──────────────────────────────────────────────────────

  static const String renewPostMutation = r'''
    mutation RenewPost($postId: ID!) {
      renewPost(postId: $postId) {
        id
        status
      }
    }
  ''';

  /// Owner-only. Returns the listing to ACTIVE with a fresh inactivity
  /// window; only ACTIVE/EXPIRED PRODUCT and ADOPTION listings qualify, and
  /// at most once per 7 days (`RENEWAL_COOLDOWN`).
  Future<(bool success, String? errorMessage)> renewPost(String postId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(renewPostMutation), variables: {'postId': postId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (true, null);
  }

  // ── Profile photo lifecycle ─────────────────────────────────────────────────

  static const String requestProfilePhotoUploadUrlMutation = r'''
    mutation RequestProfilePhotoUploadUrl($input: RequestProfilePhotoUploadInput!) {
      requestProfilePhotoUploadUrl(input: $input) {
        mediaId
        uploadUrl
        expiresAt
        maxSizeBytes
        maxWidth
        maxHeight
        allowedContentType
      }
    }
  ''';

  static const String setProfilePhotoMutation = r'''
    mutation SetProfilePhoto($mediaId: ID!) {
      setProfilePhoto(mediaId: $mediaId) {
        id
        profilePictureUrl
      }
    }
  ''';

  static const String removeProfilePhotoMutation = r'''
    mutation RemoveProfilePhoto {
      removeProfilePhoto {
        id
        profilePictureUrl
      }
    }
  ''';

  /// Requests a presigned direct-upload ticket for a new avatar. The caller
  /// must already have a static WebP ≤100,000 bytes / ≤480×480 with no
  /// metadata ready to PUT to the returned `uploadUrl`.
  Future<(Map<String, dynamic>? ticket, String? errorCode, String? errorMessage)> requestProfilePhotoUploadUrl({
    required int fileSizeBytes,
  }) async {
    final result = await client.value.mutate(
      MutationOptions(
        document: gql(requestProfilePhotoUploadUrlMutation),
        variables: {'input': {'contentType': 'image/webp', 'fileSizeBytes': fileSizeBytes}},
      ),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _errorCode(result.exception), _serverErrorMessage(result.exception));
    }
    return (result.data?['requestProfilePhotoUploadUrl'] as Map<String, dynamic>?, null, null);
  }

  /// Finalizes an uploaded avatar. On `PROFILE_PHOTO_REPLACED` (a lost race
  /// with a concurrent set/remove) the caller should refresh `me` and retry
  /// with a fresh ticket.
  Future<(String? profilePictureUrl, String? errorCode, String? errorMessage)> setProfilePhoto(String mediaId) async {
    final result = await client.value.mutate(
      MutationOptions(document: gql(setProfilePhotoMutation), variables: {'mediaId': mediaId}),
    );
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (null, _errorCode(result.exception), _serverErrorMessage(result.exception));
    }
    final user = result.data?['setProfilePhoto'] as Map<String, dynamic>?;
    return (user?['profilePictureUrl'] as String?, null, null);
  }

  /// Removes the current avatar. `profilePictureUrl` comes back null on
  /// success — render initials, never a cached provider picture.
  Future<(bool success, String? errorMessage)> removeProfilePhoto() async {
    final result = await client.value.mutate(MutationOptions(document: gql(removeProfilePhotoMutation)));
    if (result.hasException) {
      if (kDebugMode) debugPrint('GraphQL error: ${result.exception}');
      return (false, _serverErrorMessage(result.exception));
    }
    return (true, null);
  }
}
