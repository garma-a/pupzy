import 'package:geolocator/geolocator.dart';

import 'browse_location_service.dart';
import 'graphql_service.dart';
import 'location_service.dart';

/// Resolved (governorate, cityId, position) for a feed query.
class FeedLocation {
  final String? governorate;
  final String? cityId;
  final Position? position;

  const FeedLocation({this.governorate, this.cityId, this.position});
}

/// Resolves where a feed screen should search — shared by Home/Help/Adopt/Market
/// so this logic lives in exactly one place.
///
/// If the user has explicitly picked an area to browse (via the location
/// pill), that area is used as-is and GPS is skipped entirely — even if the
/// user is physically somewhere else.
///
/// Otherwise, resolves from GPS + the user's home city. Only pins to the
/// exact home city when GPS is unavailable — otherwise an exact city match
/// would silently override the distance filter, since the backend ANDs both
/// conditions together.
Future<FeedLocation> resolveFeedLocation({
  required BrowseLocationService browseLocationService,
  required LocationService locationService,
  required GraphQLService graphql,
}) async {
  final browseCity = browseLocationService.selectedCity;
  if (browseCity != null) {
    return FeedLocation(
      governorate: browseCity['governorate'] as String,
      cityId: browseCity['id'] as String,
    );
  }

  final locationFuture = locationService.resolve();
  final cityFuture = graphql.resolveViewerCity();
  final position = await locationFuture;
  final (governorate, cityId) = await cityFuture;
  return FeedLocation(
    governorate: governorate,
    cityId: position == null ? cityId : null,
    position: position,
  );
}
