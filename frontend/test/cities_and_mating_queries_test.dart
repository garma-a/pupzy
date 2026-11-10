import 'package:flutter_test/flutter_test.dart';
import 'package:graphql_flutter/graphql_flutter.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/graphql_service.dart';

class _UnusedAuth extends Fake implements AuthService {}

const _maadi = {'__typename': 'City', 'id': 'c1', 'nameEnglish': 'Al Maadi', 'nameArabic': 'المعادي', 'governorate': 'Cairo'};

/// A service whose server answers with [respond], recording each request.
GraphQLService _serviceWith(List<Request> requests, Response Function(Request request) respond) {
  final service = GraphQLService(_UnusedAuth());
  service.client.value = GraphQLClient(
    link: Link.function((request, [forward]) async* {
      requests.add(request);
      yield respond(request);
    }),
    cache: GraphQLCache(),
  );
  addTearDown(service.client.dispose);
  return service;
}

bool _asksForSearchFields(Request request) => request.operation.document == gql(GraphQLService.citiesQuery);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('fetchCities', () {
    test('asks for aliases and district, and fetches once per session', () async {
      final requests = <Request>[];
      final service = _serviceWith(
        requests,
        (_) => const Response(
          response: {},
          data: {
            '__typename': 'Query',
            'cities': [
              {
                ..._maadi,
                'status': 'OFFICIAL',
                'aliases': ['Maadi'],
                'district': null,
              },
            ],
          },
        ),
      );

      final both = await Future.wait([service.fetchCities(), service.fetchCities()]);
      final later = await service.fetchCities();

      expect(requests, hasLength(1));
      expect(_asksForSearchFields(requests.single), isTrue);
      expect(both[0].single['aliases'], ['Maadi']);
      expect(identical(both[0], later), isTrue, reason: 'one shared list');
    });

    test('falls back to the old fields when the server does not know them yet', () async {
      final requests = <Request>[];
      final service = _serviceWith(
        requests,
        (request) => _asksForSearchFields(request)
            ? const Response(
                response: {},
                errors: [
                  GraphQLError(message: 'Cannot query field "aliases" on type "City".', extensions: {'code': 'GRAPHQL_VALIDATION_FAILED'}),
                ],
              )
            : const Response(
                response: {},
                data: {
                  '__typename': 'Query',
                  'cities': [_maadi],
                },
              ),
      );

      final cities = await service.fetchCities();

      expect(cities.single['nameEnglish'], 'Al Maadi');
      expect(requests.map(_asksForSearchFields), [true, false]);
    });

    test('remembers the server lacks the fields and keeps asking the old way', () async {
      final requests = <Request>[];
      var serverUp = true;
      final service = _serviceWith(requests, (request) {
        if (_asksForSearchFields(request)) {
          return const Response(
            response: {},
            errors: [GraphQLError(message: 'Cannot query field "aliases" on type "City".')],
          );
        }
        if (!serverUp) {
          return const Response(
            response: {},
            errors: [GraphQLError(message: 'Internal server error')],
          );
        }
        return const Response(
          response: {},
          data: {
            '__typename': 'Query',
            'cities': [_maadi],
          },
        );
      });

      serverUp = false;
      expect(await service.fetchCities(), isEmpty);
      serverUp = true;
      expect(await service.fetchCities(), hasLength(1));
      expect(requests.map(_asksForSearchFields), [true, false, false]);
    });

    test('a failed fetch is not kept: the next call tries again', () async {
      final requests = <Request>[];
      var online = false;
      final service = GraphQLService(_UnusedAuth());
      service.client.value = GraphQLClient(
        link: Link.function((request, [forward]) async* {
          requests.add(request);
          if (!online) throw Exception('offline');
          yield const Response(
            response: {},
            data: {
              '__typename': 'Query',
              'cities': [
                {..._maadi, 'status': 'OFFICIAL', 'aliases': <String>[], 'district': null},
              ],
            },
          );
        }),
        cache: GraphQLCache(),
      );
      addTearDown(service.client.dispose);

      expect(await service.fetchCities(), isEmpty);
      online = true;
      expect(await service.fetchCities(), hasLength(1));
      expect(requests.map(_asksForSearchFields), [true, true], reason: 'offline is not "server lacks the fields"');
    });
  });

  group('fetchMatingFeed', () {
    Future<Request> send(Future<void> Function(GraphQLService service) call) async {
      final requests = <Request>[];
      final service = _serviceWith(
        requests,
        (_) => const Response(
          response: {},
          errors: [GraphQLError(message: 'stop')],
        ),
      );
      await call(service);
      return requests.single;
    }

    test('sends the distance and GPS position like the other feeds', () async {
      final request = await send((s) => s.fetchMatingFeed(cityId: 'c1', latitude: 30.1, longitude: 31.2, radiusKm: 10));

      expect(request.variables['radiusKm'], 10);
      expect(request.variables['viewerLocation'], {'latitude': 30.1, 'longitude': 31.2});
      expect(request.variables['filter'], {'cityId': 'c1'});
      expect(request.operation.document, gql(GraphQLService.matingFeedQuery));
      expect(GraphQLService.matingFeedQuery, contains(r'radiusKm: $radiusKm'));
      expect(GraphQLService.matingFeedQuery, contains(r'viewerLocation: $viewerLocation'));
    });

    test('"50+ km" sends no radius (nationwide) and no position without GPS', () async {
      final request = await send((s) => s.fetchMatingFeed(cityId: 'c1'));

      expect(request.variables, containsPair('radiusKm', null));
      expect(request.variables.containsKey('viewerLocation'), isFalse);
      expect(request.variables['filter'], {'cityId': 'c1'});
    });
  });
}
