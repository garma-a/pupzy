/**
 * Readable names for referenced records, shared by the `ReferenceLink`
 * component (browser) and the server-side polymorphic reference loader, so a
 * list, a show page and the Post review workspace name a record the same way.
 */
import { formatShortUuid } from './components/short-uuid.js';

const COMMENT_EXCERPT_LENGTH = 60;

function text(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

/** A person's name: English name, else Arabic name, else email, else short id. */
export function userDisplayName(params, id) {
  return (
    text(params?.full_name) ??
    text(params?.full_name_arabic) ??
    text(params?.email) ??
    formatShortUuid(id ?? params?.id, true)
  );
}

/** A single-line excerpt of about 60 characters, ending in an ellipsis when cut. */
export function excerpt(value, max = COMMENT_EXCERPT_LENGTH) {
  const flat = (text(value) ?? '').replace(/\s+/g, ' ');
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

const DELETED_LABELS = {
  users: 'Deleted account',
  posts: 'Post not found',
  comments: 'Deleted comment',
  admin_users: 'Deleted admin',
  announcements: 'Deleted announcement',
  contact_requests: 'Deleted contact request',
  adoption_applications: 'Deleted application',
};

/** Shown only when the referenced row really does not exist. */
export function deletedLabel(resourceId) {
  return DELETED_LABELS[resourceId] ?? 'Deleted record';
}

/**
 * The readable name of a referenced record.
 * `params` are the referenced row's columns, `fallbackTitle` is AdminJS's own
 * title for it (which equals the id when the resource has no title column).
 */
export function referenceTitle(resourceId, params, id, fallbackTitle) {
  switch (resourceId) {
    case 'users':
      return userDisplayName(params, id);
    case 'admin_users':
      return text(params?.full_name) ?? text(params?.email) ?? formatShortUuid(id, true);
    case 'announcements':
      return text(params?.title_en) ?? formatShortUuid(id, true);
    case 'posts':
      return text(params?.title) ?? formatShortUuid(id, true);
    case 'comments':
      return excerpt(params?.text) || formatShortUuid(id, true);
    case 'contact_requests':
      return `Contact request ${formatShortUuid(id, true)}`;
    case 'adoption_applications':
      return `Application ${formatShortUuid(id, true)}`;
    default: {
      const title = text(fallbackTitle);
      return title && title !== String(id) ? title : formatShortUuid(id, true);
    }
  }
}

/** Up to two initials for an avatar fallback. */
export function initials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join('').toUpperCase();
}
