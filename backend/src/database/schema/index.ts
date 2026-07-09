// ─────────────────────────────────────────────────────────────────────────────
// Drizzle ORM schema barrel
//
// Import order matters for Drizzle's relation resolution:
//   enums → cities → users → posts → extensions → engagement → system
//
// All tables and TypeScript types are re-exported from here so the rest of the
// codebase only ever imports from 'src/database/schema' (no deep paths).
// ─────────────────────────────────────────────────────────────────────────────

// Shared enum definitions (pgEnums + TypeScript unions)
export * from './enums';

// Lookup tables
export * from './cities.schema';

// Identity
export * from './users.schema';

// CTI base table
export * from './posts.schema';

// Media
export * from './post-media.schema';

// CTI extension tables (joined only on detail screens)
export * from './rescue-posts.schema';
export * from './lost-posts.schema';
export * from './adoption-posts.schema';
export * from './product-posts.schema';

// Engagement
export * from './post-upvotes.schema';
export * from './post-saves.schema';

// Contact & matching flows
export * from './contact-requests.schema';
export * from './adoption-applications.schema';

// Moderation & notifications
export * from './post-reports.schema';
export * from './notifications.schema';

// Alert system
export * from './saved-searches.schema';
