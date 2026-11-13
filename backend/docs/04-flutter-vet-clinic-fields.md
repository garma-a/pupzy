# App handoff: new vet clinic fields

Status: ready-for-human
Type: task
For: Matthew (Flutter app)

The vet clinic release adds three fields to `VetClinic` and changes how some clinic names and map links look. Nothing here is breaking.

## New fields

| Field                   | Type                | Meaning                                                                                  | Suggested use                                                                                            |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `is24Hours`             | `Boolean!`          | True only when the source explicitly states 24-hour operation.                           | Show a "24h" badge when true. Show nothing when false (false means "not stated", not "closed at night"). |
| `facebookUrl`           | `String` (nullable) | Clinic Facebook page URL. Null when no page was recorded.                                | Show a Facebook button only when non-null. Open with `url_launcher`.                                     |
| `isApproximateLocation` | `Boolean!`          | True when the stored point is the address area (the City centre), not the clinic itself. | Show a short hint such as "Approximate location" and avoid drawing an exact pin.                         |

For approximate clinics, `latitude` and `longitude` are the matched City centre, and `distanceKm` is measured to that centre.

## `googleMapsUrl`

`googleMapsUrl` is still `String!` and the app should keep opening it as is.

- Exact location: a Google Maps link built from the coordinates.
- Approximate location (`isApproximateLocation == true`): a Google Maps search link built from the clinic name, address and governorate, so Maps finds the clinic instead of dropping a pin on the City centre.

Do not build your own link from `latitude` and `longitude`; for approximate clinics it would point at the City centre.

## Compatibility

The fields are additive. Old app versions that do not request them keep working with no change.

The app already uses two queries that return `VetClinic`: `nearbyVetClinics(cityId:)` and `Post.nearestVetClinics`. Add the new fields to the selection in `graphql_service.dart`:

```graphql
query NearbyVetClinics($cityId: ID!) {
  nearbyVetClinics(cityId: $cityId) {
    id
    nameEnglish
    nameArabic
    phoneNumber
    address
    website
    facebookUrl
    is24Hours
    isApproximateLocation
    latitude
    longitude
    distanceKm
    googleMapsUrl
    whatsappPhoneUrl
  }
}
```

Use the same three added lines inside `nearestVetClinics { ... }` on the post detail query. Keep `nearestVetClinics` out of feed queries, as before.

## Names with a place label

Clinics with similar names now show a place label in parentheses, for example "Pet Care Clinic (Damanhour)". The label is part of `nameEnglish` / `nameArabic`, so do not truncate names too aggressively and let the title wrap to two lines.
