/**
 * Parses numeric latitude and longitude from various input formats
 * (discrete lat/lng fields, EWKT POINT(lng lat), comma-separated strings, objects, JSON strings, or PostGIS EWKB hex strings).
 *
 * @param {string|object|unknown} val
 * @returns {{ lat: number, lng: number } | null}
 */
export function parseCoordinatesValue(val) {
  if (!val) return null;

  if (typeof val === 'object') {
    // Check nested params if AdminJS record object passed
    if (val.params && typeof val.params === 'object') {
      const parsedParams = parseCoordinatesValue(val.params);
      if (parsedParams) return parsedParams;
    }
    // Check center_point if City object passed
    if (val.center_point !== undefined && val.center_point !== null) {
      const parsedCp = parseCoordinatesValue(val.center_point);
      if (parsedCp) return parsedCp;
    }
    // Check coordinates property if payload / wrapper passed
    if (val.coordinates !== undefined && val.coordinates !== null) {
      const parsedCoords = parseCoordinatesValue(val.coordinates);
      if (parsedCoords) return parsedCoords;
    }
    // Check dotted keys 'coordinates.latitude' / 'coordinates.longitude'
    if (val['coordinates.latitude'] !== undefined && val['coordinates.longitude'] !== undefined) {
      const lat = Number(val['coordinates.latitude']);
      const lng = Number(val['coordinates.longitude']);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
    // Check direct lat / latitude & lng / longitude
    const lat = Number(val.lat ?? val.latitude);
    const lng = Number(val.lng ?? val.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    return null;
  }

  if (typeof val === 'string') {
    const str = val.trim();
    if (!str) return null;

    // JSON string format
    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const parsed = JSON.parse(str);
        return parseCoordinatesValue(parsed);
      } catch {
        // Fall through
      }
    }

    // WKT / EWKT: POINT(longitude latitude) or SRID=4326;POINT(lng lat)
    const pointMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (pointMatch) {
      const lng = parseFloat(pointMatch[1]);
      const lat = parseFloat(pointMatch[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
      return null;
    }

    // Comma-separated: "lat, lng" or "lat,lng"
    const commaMatch = str.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
    if (commaMatch) {
      const lat = parseFloat(commaMatch[1]);
      const lng = parseFloat(commaMatch[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
      return null;
    }

    // PostGIS EWKB hex string (at least 42 hex chars)
    if (/^[0-9a-fA-F]{42,}$/.test(str)) {
      try {
        const bytes = new Uint8Array(str.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
        const view = new DataView(bytes.buffer);
        const isLE = bytes[0] === 1;
        const type = view.getUint32(1, isLE);
        const hasSrid = (type & 0x20000000) !== 0;
        const offset = hasSrid ? 9 : 5;
        const lng = view.getFloat64(offset, isLE);
        const lat = view.getFloat64(offset + 8, isLE);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}
