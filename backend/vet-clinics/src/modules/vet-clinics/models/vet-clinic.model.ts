/**
 * vet-clinic.model.ts
 *
 * NestJS Code-first GraphQL ObjectType for VetClinic.
 *
 * Used as a field on Post detail responses via @ResolveField.
 * Coordinates are exposed for the deep-link — consistent with how RESCUE/LOST
 * post coordinates are used. Vet clinics are public POIs so no privacy concern.
 */

import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType('VetClinic', {
  description: 'A veterinary clinic with proximity data relative to a post location.',
})
export class VetClinicDto {
  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true, description: 'Clinic name in English.' })
  name_english: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Clinic name in Arabic — shown first for Arabic-locale users.',
  })
  name_arabic: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Phone number in E.164 format (+201XXXXXXXXX where available).',
  })
  phone_number: string | null;

  @Field(() => String, { nullable: true, description: 'Full address string.' })
  address: string | null;

  @Field(() => String, { nullable: true })
  website: string | null;

  // ── Coordinates ────────────────────────────────────────────────────────────
  // Exposed so Flutter can build the Google Maps deep-link.
  // Vet clinics are public POIs — no coordinate privacy concern.

  @Field(() => Float, { description: 'WGS-84 latitude.' })
  latitude: number;

  @Field(() => Float, { description: 'WGS-84 longitude.' })
  longitude: number;

  // ── Computed fields ────────────────────────────────────────────────────────

  @Field(() => Float, {
    description:
      'Geodesic distance in kilometres from the post location to this clinic. ' +
      'Computed with ST_Distance(::geography) — accurate on the WGS-84 ellipsoid.',
  })
  distance_km: number;

  @Field(() => String, {
    description:
      'Pre-built Google Maps deep-link (maps.google.com/?q=lat,lon). ' +
      'Flutter opens with url_launcher — no Maps SDK needed.',
  })
  google_maps_url: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Pre-built WhatsApp deep-link (wa.me/PHONENUMBER). ' +
      'Null if the clinic has no phone number in OSM.',
  })
  whatsapp_phone_url: string | null;
}
