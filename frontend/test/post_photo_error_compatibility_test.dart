import 'package:flutter_test/flutter_test.dart';
import 'package:graphql_flutter/graphql_flutter.dart';
import 'package:pupzy/services/auth_service.dart';
import 'package:pupzy/services/graphql_service.dart';

class _UnusedAuth extends Fake implements AuthService {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the existing app client returns a missing-photo GraphQL error for the form to display', () async {
    const message = 'At least one photo must upload successfully before publishing. Please upload a photo and try again.';
    final service = GraphQLService(_UnusedAuth());
    service.client.value = GraphQLClient(
      link: Link.function((request, [forward]) async* {
        expect(request.variables['input'], isNot(contains('mediaIds')));
        yield const Response(
          response: {},
          errors: [
            GraphQLError(message: message, extensions: {'code': 'VALIDATION_ERROR'}),
          ],
        );
      }),
      cache: GraphQLCache(),
    );
    addTearDown(service.client.dispose);

    final (post, error) = await service.createProductPost(
      title: 'Dog crate',
      description: 'A large crate in good condition.',
      latitude: 30.0444,
      longitude: 31.2357,
      category: 'CARE',
      condition: 'USED',
      isFree: true,
      mediaIds: [],
    );

    expect(post, isNull);
    expect(error, message);
    expect(service.takeTermsRequirement(), isNull);
  });
}
