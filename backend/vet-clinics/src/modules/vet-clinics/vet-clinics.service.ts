/**
 * vet-clinics.service.ts
 *
 * Provides proximity-based vet clinic lookup for post detail screens.
 *
 * The core query uses PostGIS's <-> KNN operator with a GIST index — this is
 * O(log n) regardless of how many clinics are in the table.
 *
 * Typical usage (from PostsResolver):
 *
 *   @ResolveField(() => [VetClinic])
 *   async nearestVetClinics(@Parent() post: Post): Promise<VetClinic[]> {
 *     return this.vetClinicsService.findNearest(
 *       post.coordinates.latitude,
 *       post.coordinates.longitude,
 *       3,
 *     );
 *   }
 */

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service'; // adjust import path
import { VetClinicDto } from './models/vet-clinic.model';

// ─── Raw DB row shape returned by the proximity query ─────────────────────────

interface VetClinicQueryRow {
  id: string;
  name_english: string | null;
  name_arabic: string | null;
  phone_number: string | null;
  address: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
  distance_km: number;
}

@Injectable()
export class VetClinicsService {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * findNearest
   *
   * Returns the `limit` closest active vet clinics to (latitude, longitude).
   *
   * Query strategy:
   * 1. `<->` KNN operator does an index-only GIST scan — no seq scan.
   *    Uses Cartesian distance for ordering (fine for nearby results).
   * 2. `ST_Distance(...::geography)` converts to metres on the WGS-84 ellipsoid
   *    for accurate distance_km reporting (what you show in the UI).
   * 3. ST_X / ST_Y extract coordinates for the Google Maps deep-link.
   *
   * @param latitude   Post's latitude
   * @param longitude  Post's longitude
   * @param limit      Max results (default 3 — enough for a "Nearest Vets" card)
   */
  async findNearest(
    latitude: number,
    longitude: number,
    limit = 3,
  ): Promise<VetClinicDto[]> {
    const rows = await this.drizzle.db.execute<VetClinicQueryRow>(sql`
      SELECT
        vc.id,
        vc.name_english,
        vc.name_arabic,
        vc.phone_number,
        vc.address,
        vc.website,
        ST_Y(vc.coordinates::geometry)                              AS latitude,
        ST_X(vc.coordinates::geometry)                              AS longitude,
        ROUND(
          (ST_Distance(
            vc.coordinates::geography,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
          ) / 1000.0)::numeric,
          2
        )                                                           AS distance_km
      FROM vet_clinics vc
      WHERE vc.is_active = true
      ORDER BY
        vc.coordinates <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      LIMIT ${limit}
    `);

    return rows.rows.map((row) => this.toDto(row));
  }

  /**
   * findNearestForCity
   *
   * Alternative: find nearest clinics within a city (for adoption/product posts
   * where exact coordinates are hidden but city is known).
   * Uses the city's center_point as the anchor.
   *
   * @param cityId  The post's city_id FK
   * @param limit   Max results
   */
  async findNearestForCity(
    cityId: string,
    limit = 3,
  ): Promise<VetClinicDto[]> {
    const rows = await this.drizzle.db.execute<VetClinicQueryRow>(sql`
      SELECT
        vc.id,
        vc.name_english,
        vc.name_arabic,
        vc.phone_number,
        vc.address,
        vc.website,
        ST_Y(vc.coordinates::geometry)                              AS latitude,
        ST_X(vc.coordinates::geometry)                              AS longitude,
        ROUND(
          (ST_Distance(
            vc.coordinates::geography,
            c.center_point::geography
          ) / 1000.0)::numeric,
          2
        )                                                           AS distance_km
      FROM vet_clinics vc
      CROSS JOIN (
        SELECT center_point FROM cities WHERE id = ${cityId} LIMIT 1
      ) c
      WHERE vc.is_active = true
      ORDER BY vc.coordinates <-> c.center_point
      LIMIT ${limit}
    `);

    return rows.rows.map((row) => this.toDto(row));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private toDto(row: VetClinicQueryRow): VetClinicDto {
    return {
      id: row.id,
      name_english: row.name_english,
      name_arabic: row.name_arabic,
      phone_number: row.phone_number,
      address: row.address,
      website: row.website,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      distance_km: Number(row.distance_km),
      // Google Maps deep-link — same pattern as RESCUE/LOST posts
      // Flutter opens with url_launcher, no Maps SDK needed
      google_maps_url: `https://maps.google.com/?q=${row.latitude},${row.longitude}`,
      whatsapp_phone_url: row.phone_number
        ? `https://wa.me/${row.phone_number.replace('+', '')}`
        : null,
    };
  }
}
