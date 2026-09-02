-- Enforce WGS84 coordinate ranges and Point geometry on vet_clinics coordinates
ALTER TABLE "vet_clinics" DROP CONSTRAINT IF EXISTS "chk_vet_clinics_coordinates_range";
ALTER TABLE "vet_clinics" ADD CONSTRAINT "chk_vet_clinics_coordinates_range"
  CHECK (
    ST_GeometryType(coordinates) = 'ST_Point'
    AND ST_SRID(coordinates) = 4326
    AND ST_X(coordinates) >= -180 AND ST_X(coordinates) <= 180
    AND ST_Y(coordinates) >= -90 AND ST_Y(coordinates) <= 90
  );
