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
        authProvider
        isVerified
        profileComplete
        phoneNumber
        cityId
        city {
          id
          nameEn
          nameAr
          governorate
        }
        fullNameArabic
        rescuesCount
        adoptedCount
        helpingCount
        languagePreference
        notificationsEnabled
        privacyLevel
        createdAt
        updatedAt
      }
    }
  ''';

  static const String citiesQuery = r'''
    query GetCities {
      cities {
        id
        nameEn
        nameAr
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
        cityId
        profileComplete
      }
    }
  ''';

  static const String updateProfileMutation = r'''
    mutation UpdateProfile($input: UpdateProfileInput!) {
      updateProfile(input: $input) {
        id
        fullName
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
}
