/**
 * The sidebar, grouped by task. One list drives both the sidebar and every
 * resource's `navigation` option, so the order and names live in one place.
 * `topLevel` groups hold a single entry shown without a heading.
 */
export const NAV_GROUPS = Object.freeze([
  {
    name: 'Reports',
    icon: 'Flag',
    resources: ['post_reports', 'comment_reports', 'account_reports'],
  },
  { name: 'Content', icon: 'FileText', resources: ['posts', 'comments', 'post_media'] },
  { name: 'People', icon: 'Users', resources: ['users'] },
  { name: 'Places', icon: 'Map', resources: ['cities', 'vet_clinics'] },
  { name: 'Announcements', icon: 'Bell', topLevel: true, resources: ['announcements'] },
  { name: 'Admin', icon: 'Lock', resources: ['admin_users', 'moderation_actions', 'notifications'] },
  {
    name: 'Records',
    icon: 'Archive',
    collapsedByDefault: true,
    resources: [
      'rescue_posts',
      'lost_posts',
      'adoption_posts',
      'product_posts',
      'mating_posts',
      'post_saves',
      'post_upvotes',
      'contact_requests',
      'adoption_applications',
      'vet_clinic_location_audits',
    ],
  },
]);

/** Plain-language resource names, shown in the sidebar, page titles and breadcrumbs. */
export const RESOURCE_LABELS = Object.freeze({
  post_reports: 'Post Reports',
  comment_reports: 'Comment Reports',
  account_reports: 'Account Reports',
  posts: 'Posts',
  comments: 'Comments',
  post_media: 'Post photos',
  users: 'Users',
  cities: 'Cities',
  vet_clinics: 'Vet clinics',
  announcements: 'Announcements',
  admin_users: 'Admin users',
  moderation_actions: 'Audit log',
  notifications: 'Notifications',
  rescue_posts: 'Rescue details',
  lost_posts: 'Lost and found details',
  adoption_posts: 'Adoption details',
  product_posts: 'Product details',
  mating_posts: 'Mating details',
  post_saves: 'Saved posts',
  post_upvotes: 'Upvotes',
  contact_requests: 'Contact requests',
  adoption_applications: 'Adoption applications',
  vet_clinic_location_audits: 'Vet clinic location audits',
});

/** `navigation` option for a resource id, or undefined for one that is not in the sidebar. */
export function navigationFor(resourceId) {
  const group = NAV_GROUPS.find((candidate) => candidate.resources.includes(resourceId));
  if (!group) return undefined;
  return { name: group.topLevel ? null : group.name, icon: group.icon };
}

/** Adds each resource's plain name (`resources.<id>.labels.<id>`) to a map of resource translations. */
export function withResourceLabels(resourceTranslations = {}) {
  const result = { ...resourceTranslations };
  for (const [id, label] of Object.entries(RESOURCE_LABELS)) {
    result[id] = {
      ...result[id],
      actions: { list: label, ...result[id]?.actions },
      labels: { ...result[id]?.labels, [id]: label },
    };
  }
  return result;
}

/**
 * Orders the visible resources into sidebar groups. Entries AdminJS did not
 * give a link (the admin may not open them) are left out, and so is a group
 * left empty, which is how super-admin-only entries stay hidden from admins.
 */
export function buildNavigation(resources) {
  const available = new Map(resources.filter((r) => r.href && r.navigation?.show !== false).map((r) => [r.id, r]));
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.resources.filter((id) => available.has(id)).map((id) => available.get(id)),
  })).filter((group) => group.items.length > 0);
}
