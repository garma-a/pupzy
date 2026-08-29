import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdminJS, { ComponentLoader } from 'adminjs';
import { Database, Resource } from '@adminjs/sql';

import { DashboardStatsCache } from './dashboard/dashboard-cache.js';
import { buildDashboardHandler } from './dashboard/dashboard-handler.js';
import { pupzyTheme } from './theme.js';
import { buildAdminUsersResource } from './resources/admin-users.resource.js';
import { buildAdoptionApplicationsResource } from './resources/adoption-applications.resource.js';
import { buildAdoptionPostsResource } from './resources/adoption-posts.resource.js';
import { buildCitiesResource } from './resources/cities.resource.js';
import { buildContactRequestsResource } from './resources/contact-requests.resource.js';
import { buildLostPostsResource } from './resources/lost-posts.resource.js';
import { buildMatingPostsResource } from './resources/mating-posts.resource.js';
import { buildModerationActionsResource } from './resources/moderation-actions.resource.js';
import { buildNotificationsResource } from './resources/notifications.resource.js';
import { buildPostMediaResource } from './resources/post-media.resource.js';
import { buildPostReportsResource } from './resources/post-reports.resource.js';
import { buildPostSavesResource } from './resources/post-saves.resource.js';
import { buildPostUpvotesResource } from './resources/post-upvotes.resource.js';
import { buildPostsResource } from './resources/posts.resource.js';
import { buildProductPostsResource } from './resources/product-posts.resource.js';
import { buildRescuePostsResource } from './resources/rescue-posts.resource.js';
import { attachCacheInvalidation } from './resources/resource-helpers.js';
import { buildAdminSqlDatabase } from './sql-adapter.js';
import { buildSavedSearchesResource } from './resources/saved-searches.resource.js';
import { buildUsersResource } from './resources/users.resource.js';
import { buildVetClinicsResource } from './resources/vet-clinics.resource.js';
import { buildVetClinicLocationAuditsResource } from './resources/vet-clinic-location-audits.resource.js';

AdminJS.registerAdapter({ Database, Resource });

export const ADMIN_RESOURCE_TABLES = Object.freeze([
  'users',
  'posts',
  'rescue_posts',
  'lost_posts',
  'adoption_posts',
  'product_posts',
  'mating_posts',
  'post_media',
  'post_upvotes',
  'post_saves',
  'post_reports',
  'contact_requests',
  'adoption_applications',
  'saved_searches',
  'notifications',
  'cities',
  'vet_clinics',
  'admin_users',
  'moderation_actions',
  'vet_clinic_location_audits',
]);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function buildAdminJs(databaseUrl, databaseName, pool, options = {}) {
  const cache =
    options.cache ??
    new DashboardStatsCache({
      clock: options.clock,
      ttlMs: options.ttlMs,
    });

  const componentLoader = new ComponentLoader();
  const components = {
    Dashboard: componentLoader.add('Dashboard', path.join(currentDirectory, 'dashboard', 'dashboard-component.jsx')),
    ModerationAction: componentLoader.add(
      'ModerationAction',
      path.join(currentDirectory, 'components', 'moderation-action-component.jsx'),
    ),
    ShortUuid: componentLoader.add('ShortUuid', path.join(currentDirectory, 'components', 'short-uuid-component.jsx')),
    MappedLocationEdit: componentLoader.add(
      'MappedLocationEdit',
      path.join(currentDirectory, 'components', 'mapped-location-edit-component.jsx'),
    ),
    MappedLocationShow: componentLoader.add(
      'MappedLocationShow',
      path.join(currentDirectory, 'components', 'mapped-location-show-component.jsx'),
    ),
  };

  const { db, sqlAdapterPool } = await buildAdminSqlDatabase(
    {
      connectionString: databaseUrl,
      database: databaseName,
      statement_timeout: 8_000,
      application_name: 'pupzy-adminjs-sql',
    },
    {
      tables: options.tables ?? ADMIN_RESOURCE_TABLES,
    },
  );

  const rawResources = [
    buildUsersResource(db, pool, components, cache),
    buildPostsResource(db, pool, components, cache),
    buildRescuePostsResource(db, components),
    buildLostPostsResource(db, components),
    buildAdoptionPostsResource(db, components),
    buildProductPostsResource(db, components),
    buildMatingPostsResource(db, components),
    buildPostMediaResource(db, components),
    buildPostUpvotesResource(db, components),
    buildPostSavesResource(db, components),
    buildPostReportsResource(db, components),
    buildContactRequestsResource(db, components),
    buildAdoptionApplicationsResource(db, components),
    buildSavedSearchesResource(db, components),
    buildNotificationsResource(db, components),
    buildCitiesResource(db, components),
    buildVetClinicsResource(db, pool, components, cache),
    buildAdminUsersResource(db, components),
    buildModerationActionsResource(db, components),
    buildVetClinicLocationAuditsResource(db, components),
  ];

  const resources = rawResources.map((resource) => attachCacheInvalidation(resource, cache));

  const dashboardHandler = buildDashboardHandler(pool, cache);
  const admin = new AdminJS({
    rootPath: '/admin',
    branding: {
      companyName: 'Pupzy Admin',
      logo: '/admin/assets/logo.png',
      favicon: '/admin/assets/favicon.png',
      withMadeWithLove: false,
      theme: pupzyTheme,
    },
    assets: {
      styles: [
        'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Playfair+Display:ital,wght@0,700;0,800;1,700;1,800&display=swap',
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
        '/admin/assets/pupzy-theme.css',
      ],
      scripts: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'],
    },
    componentLoader,
    resources,
    dashboard: {
      component: components.Dashboard,
      handler: dashboardHandler,
    },
  });

  return {
    admin,
    sqlAdapterPool,
    cache,
  };
}
