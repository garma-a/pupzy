/**
 * Parses numeric latitude and longitude from various input formats
 * (discrete lat/lng fields, EWKT POINT(lng lat), comma-separated strings, objects, or PostGIS EWKB hex strings).
 *
 * @param {string|object|unknown} val
 * @returns {{ lat: number, lng: number } | null}
 */
export function parseCoordinatesValue(val) {
  if (!val) return null;
  if (typeof val === 'object') {
    const lat = Number(val.lat ?? val.latitude);
    const lng = Number(val.lng ?? val.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  if (typeof val === 'string') {
    const str = val.trim();
    const pointMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (pointMatch) {
      return { lng: parseFloat(pointMatch[1]), lat: parseFloat(pointMatch[2]) };
    }
    const commaMatch = str.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
    if (commaMatch) {
      return { lat: parseFloat(commaMatch[1]), lng: parseFloat(commaMatch[2]) };
    }
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
