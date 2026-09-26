import '../models/adoption_application.dart';
import 'graphql_service.dart';

/// The viewer's application to [postId], wherever it sits in their list.
///
/// There is no per-Post filter on `myAdoptionApplications`, so this pages
/// through the viewer's applications (50 at a time, at most 2,000) until it
/// finds one. An older approved application is still found, so the listing
/// offers WhatsApp rather than a new application. Returns the error message
/// when a page fails, so the caller doesn't mistake "couldn't check" for
/// "no application".
Future<(AdoptionApplication? application, String? errorMessage)> findMyAdoptionApplication(
  GraphQLService graphql,
  String postId,
) async {
  String? after;
  for (var page = 0; page < 40; page++) {
    final result = await graphql.fetchMyAdoptionApplications(first: 50, after: after);
    if (result.failed) return (null, result.errorMessage);
    for (final a in result.items) {
      if (a.targetPostId == postId) return (a, null);
    }
    if (!result.hasNextPage) break;
    after = result.endCursor;
  }
  return (null, null);
}
