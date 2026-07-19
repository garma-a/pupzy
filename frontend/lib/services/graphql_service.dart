import 'package:flutter/foundation.dart';
import 'package:graphql_flutter/graphql_flutter.dart';

import '../config/api_config.dart';
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

  static const String createProductPostMutation = r'''
    mutation CreateProductPost($input: CreateProductPostInput!) {
      createProductPost(input: $input) {
        id
        title
      }
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
      debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['me'];
  }

  Future<List<Map<String, dynamic>>> fetchCities() async {
    final result = await client.value.query(
      QueryOptions(document: gql(citiesQuery)),
    );
    if (result.hasException) {
      debugPrint('GraphQL error: ${result.exception}');
      return [];
    }
    final list = result.data?['cities'] as List<dynamic>?;
    return list?.cast<Map<String, dynamic>>() ?? [];
  }

  Future<Map<String, dynamic>?> completeProfile({
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
      debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['completeProfile'];
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
      debugPrint('GraphQL error: ${result.exception}');
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
      debugPrint('GraphQL error: ${result.exception}');
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
      debugPrint('GraphQL error: ${result.exception}');
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
      debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['createRescuePost'];
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
      debugPrint('GraphQL error: ${result.exception}');
      return null;
    }
    return result.data?['createProductPost'];
  }
}
