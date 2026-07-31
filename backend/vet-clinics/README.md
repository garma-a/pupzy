# Pubzy — Vet Clinics Data & Integration

Proximity-based vet clinic lookup for Rescue, Lost, and Adoption post detail screens.

---

## Architecture overview

```
OpenStreetMap (Overpass API)
        │
        ▼
collect-vet-clinics.ts  ──►  scripts/output/vet_clinics_raw.json
        │
        ▼
seed-vet-clinics.ts     ──►  vet_clinics (PostgreSQL + PostGIS)
                                     │
                                     ▼ ST_Distance <-> KNN
                         VetClinicsService.findNearest()
                                     │
                                     ▼
                         PostsResolver @ResolveField nearestVetClinics
                                     │
                                     ▼
                         Flutter post detail screen
                         (url_launcher → Google Maps / WhatsApp)
```

---

## Step 1 — Run the migration

```bash
# Apply the migration to your Railway PostgreSQL instance
psql $DATABASE_URL -f migrations/0001_create_vet_clinics.sql
```

Or if you're using Drizzle migrations, import `vet-clinics.ts` into your schema
index and let `drizzle-kit generate` produce the migration file.

---

## Step 2 — Collect the data from OpenStreetMap

```bash
npx ts-node scripts/collect-vet-clinics.ts
```

This hits the Overpass API (free, no key required) and writes:

```
scripts/output/vet_clinics_raw.json   # ~300-500 Egyptian vet clinics
```

Expected output:
```
Pubzy — Vet Clinics Data Collector
Source: OpenStreetMap via Overpass API
Region: Egypt (bbox)

  Trying https://overpass-api.de/api/interpreter...
✓ Success from https://overpass-api.de/api/interpreter

Total OSM elements: 412
Extracted:  387 clinics
Skipped (no coordinates): 8
Skipped (no name): 17

Coverage by governorate hint:
  Cairo: 98
  Alexandria: 61
  Giza: 54
  Unknown: 102     ← clinics without addr:governorate tag
  ...

✓ Saved 387 clinics → scripts/output/vet_clinics_raw.json
```

### What data do you get?

| Field            | Source                        | Coverage |
|------------------|-------------------------------|----------|
| name_arabic      | OSM `name:ar` / `name`        | ~70%     |
| name_english     | OSM `name:en` / `name`        | ~40%     |
| latitude/longitude | OSM node coords / centroid  | 100%     |
| phone_number     | OSM `phone` / `contact:phone` | ~25%     |
| address          | OSM `addr:*` tags             | ~30%     |
| website          | OSM `website`                 | ~5%      |

OSM coverage in Egypt is good for coordinates and Arabic names; phone/address
is sparser. Coordinates are what matter most for the proximity feature.

---

## Step 3 — Seed the database

```bash
DATABASE_URL=postgresql://... npx ts-node scripts/seed-vet-clinics.ts
```

The seeder:
1. Reads `vet_clinics_raw.json`
2. For each clinic, runs a PostGIS KNN query to find the nearest city in your
   `cities` table and assigns `city_id`
3. Inserts in batches of 50 with `ON CONFLICT (osm_id) DO NOTHING` — safe to
   re-run anytime without duplicates

**Seed your `cities` table first** — if it's empty, all `city_id` values will
be NULL (the clinics still insert, but city linking is lost).

---

## Step 4 — Integrate into PostsResolver

Add to your existing `PostsResolver`:

```typescript
// 1. Inject VetClinicsService
constructor(
  private readonly postsService: PostsService,
  private readonly vetClinicsService: VetClinicsService, // ← add this
) {}

// 2. Add the ResolveField
@ResolveField(() => [VetClinicDto])
async nearestVetClinics(@Parent() post: Post): Promise<VetClinicDto[]> {
  switch (post.post_type) {
    case 'RESCUE':
    case 'LOST':
      return this.vetClinicsService.findNearest(
        post.coordinates.latitude,
        post.coordinates.longitude,
        3,
      );
    case 'ADOPTION':
      return this.vetClinicsService.findNearestForCity(post.city_id, 3);
    case 'PRODUCT':
    default:
      return [];
  }
}
```

See `vet-clinics-resolver-snippet.ts` for the full annotated version.

---

## Flutter query (Matheo)

```graphql
query GetRescueDetail($id: ID!) {
  post(id: $id) {
    id
    title
    # ... other post fields ...
    nearestVetClinics {
      id
      nameEnglish
      nameArabic
      distanceKm
      phoneNumber
      googleMapsUrl       # → url_launcher opens Google Maps
      whatsappPhoneUrl    # → url_launcher opens WhatsApp (null if no phone)
    }
  }
}
```

Flutter renders the vet clinics as a horizontal card strip at the bottom of
rescue/adoption detail screens. Each card has:
- Name (Arabic preferred, English fallback)  
- Distance in km  
- "Directions" button → `googleMapsUrl` via `url_launcher`  
- "Call" button → `phoneNumber` via `url_launcher` (hidden if null)

---

## Re-seeding / keeping data fresh

OSM data improves over time. Re-run anytime:

```bash
npx ts-node scripts/collect-vet-clinics.ts   # refreshes raw JSON
DATABASE_URL=... npx ts-node scripts/seed-vet-clinics.ts  # upserts new entries
```

`ON CONFLICT (osm_id) DO NOTHING` means existing rows are never overwritten
by the seed script — AdminJS manual edits (corrected phone numbers, etc.) are
preserved. To force-update an OSM entry, mark it as source=MANUAL in AdminJS.

---

## Optional: Google Places enrichment

For higher phone/address coverage in major cities (Cairo, Alexandria, Giza),
run a second pass using the Google Places API:

```
GET https://maps.googleapis.com/maps/api/place/textsearch/json
  ?query=veterinary+clinic+cairo
  &type=veterinary_care
  &key=YOUR_KEY
```

Insert results with `source = 'GOOGLE_PLACES'` and no `osm_id`.
Use `ON CONFLICT DO NOTHING` on a lat/lng grid cell to avoid duplication
with existing OSM entries for the same location.

Google Places has much better phone coverage (~80%) but costs ~$17 per 1000
requests. For 500 clinics across 5 cities: ~$8–10 total one-time cost.

---

## PostGIS query explained

```sql
SELECT
  vc.id,
  vc.name_english,
  vc.name_arabic,
  ST_Distance(
    vc.coordinates::geography,
    ST_SetSRID(ST_MakePoint($lon, $lat), 4326)::geography
  ) / 1000 AS distance_km
FROM vet_clinics vc
WHERE vc.is_active = true
ORDER BY
  vc.coordinates <-> ST_SetSRID(ST_MakePoint($lon, $lat), 4326)
LIMIT 3;
```

| Clause | Purpose |
|--------|---------|
| `<->` in ORDER BY | KNN index scan via `idx_vet_clinics_coordinates` (GIST). Fast. |
| `::geography` cast | Switches ST_Distance to geodesic (WGS-84 ellipsoid). Accurate km. |
| `LIMIT 3` | Only 3 nearest — no need for ST_DWithin radius filter. |

EXPLAIN ANALYZE should show **Index Scan** on `idx_vet_clinics_coordinates`,
not a Seq Scan, even with 1000+ clinic rows.
