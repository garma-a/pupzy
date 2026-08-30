import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.schema';
import { cities } from './cities.schema';
import { vetClinics, geometryPoint } from './vet-clinics.schema';

/**
 * Append-only audit log for Vet Clinic City-disagreement overrides.
 *
 * Records administrator, clinic, selected City, nearest official City,
 * representative coordinates, discrepancy details, justification reason,
 * and timestamp.
 */
export const vetClinicLocationAudits = pgTable(
  'vet_clinic_location_audits',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    vetClinicId: uuid('vet_clinic_id')
      .notNull()
      .references(() => vetClinics.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    selectedCityId: uuid('selected_city_id')
      .notNull()
      .references(() => cities.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    nearestCityId: uuid('nearest_city_id')
      .notNull()
      .references(() => cities.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    coordinates: geometryPoint('coordinates').notNull(),
    discrepancyDetails: jsonb('discrepancy_details'),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicIdx: index('idx_vet_clinic_location_audits_clinic').on(table.vetClinicId, table.createdAt),
    adminIdx: index('idx_vet_clinic_location_audits_admin').on(table.adminUserId, table.createdAt),
    createdAtIdx: index('idx_vet_clinic_location_audits_created_at').on(table.createdAt),
    reasonNonblankCheck: check(
      'chk_vet_clinic_location_audits_reason_nonblank',
      sql`length(trim(${table.reason})) > 0`,
    ),
    coordinatesRangeCheck: check(
      'chk_vet_clinic_location_audits_coordinates_range',
      sql`ST_GeometryType(${table.coordinates}) = 'ST_Point' AND ST_SRID(${table.coordinates}) = 4326 AND ST_X(${table.coordinates}) >= -180 AND ST_X(${table.coordinates}) <= 180 AND ST_Y(${table.coordinates}) >= -90 AND ST_Y(${table.coordinates}) <= 90`,
    ),
  }),
);

export type VetClinicLocationAudit = typeof vetClinicLocationAudits.$inferSelect;
export type NewVetClinicLocationAudit = typeof vetClinicLocationAudits.$inferInsert;
