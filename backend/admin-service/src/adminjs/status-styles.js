/** One meaning → style map for every status in the moderation desk. */
export const STATUS_STYLES = Object.freeze({
  open: { color: '#8F421A', background: '#F7D1C0' },
  flagged: { color: '#9D0616', background: '#F9E5E7' },
  neutral: { color: '#674B40', background: '#F5EDE3' },
  success: { color: '#246F59', background: '#E7F3EF' },
  removed: { color: '#FFFFFF', background: '#9D0616' },
  pending: { color: '#784014', background: '#FFF1D6' },
});
const MEANINGS = Object.freeze({
  OPEN: 'open',
  post_report: 'open',
  comment_report: 'open',
  account_report: 'open',
  FLAGGED: 'flagged',
  flagged: 'flagged',
  FAILED: 'flagged',
  CRITICAL: 'flagged',
  REMOVED: 'removed',
  BANNED: 'removed',
  PENDING: 'pending',
  PENDING_AUTO_REVIEW: 'pending',
  pending: 'pending',
  SENDING: 'pending',
  URGENT: 'pending',
  IMAGE_HIDDEN: 'pending',
  HIDDEN: 'pending',
  ACTIVE: 'success',
  CLEAN: 'success',
  ACTION_TAKEN: 'success',
  SENT: 'success',
  APPROVED: 'success',
  ACCEPTED: 'success',
  RESOLVED: 'success',
  REUNITED: 'success',
  ADOPTED: 'success',
  SOLD: 'success',
});
export const statusMeaning = (value) => MEANINGS[value] ?? 'neutral';
export function plainValue(value) {
  const words = String(value ?? '')
    .replaceAll('_', ' ')
    .toLowerCase();
  return (
    {
      PENDING_AUTO_REVIEW: 'Pending review',
      NO_ACTION: 'No action',
      ACTION_TAKEN: 'Action taken',
      OSM: 'OpenStreetMap',
      GOOGLE_PLACES: 'Google Places',
      APARTMENT_OK: 'Apartment suitable',
      SUPER_ADMIN: 'Super admin',
    }[value] ?? words.charAt(0).toUpperCase() + words.slice(1)
  );
}
