import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdminJS, { ComponentLoader } from 'adminjs';
import { Database } from '@adminjs/sql';

import { DashboardStatsCache } from './dashboard/dashboard-cache.js';
import { buildDashboardHandler } from './dashboard/dashboard-handler.js';
import { pupzyTheme } from './theme.js';
import { PROPERTY_LABELS } from './property-labels.js';
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
import { buildCommentReportsResource } from './resources/comment-reports.resource.js';
import { buildAccountReportsResource } from './resources/account-reports.resource.js';
import { buildPostSavesResource } from './resources/post-saves.resource.js';
import { buildPostUpvotesResource } from './resources/post-upvotes.resource.js';
import { buildPostsResource } from './resources/posts.resource.js';
import { buildProductPostsResource } from './resources/product-posts.resource.js';
import { buildRescuePostsResource } from './resources/rescue-posts.resource.js';
import { attachCacheInvalidation, attachPopulatedSanitizer } from './resources/resource-helpers.js';
import { QueueAwareSqlResource, buildAdminSqlDatabase } from './sql-adapter.js';
import { buildUsersResource } from './resources/users.resource.js';
import { buildVetClinicsResource } from './resources/vet-clinics.resource.js';
import { buildVetClinicLocationAuditsResource } from './resources/vet-clinic-location-audits.resource.js';
import { buildCommentsResource } from './resources/comments.resource.js';
import { attachPostDetailReviewWorkspace } from './review/post-review.js';

AdminJS.registerAdapter({ Database, Resource: QueueAwareSqlResource });

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
  'comment_reports',
  'account_reports',
  'comments',
  'contact_requests',
  'adoption_applications',
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
  componentLoader.override('Login', path.join(currentDirectory, 'components', 'login-component.jsx'));
  componentLoader.override(
    'DefaultShowProperty',
    path.join(currentDirectory, 'components', 'default-show-property-component.jsx'),
  );
  componentLoader.override(
    'DefaultDatetimeShowProperty',
    path.join(currentDirectory, 'components', 'default-datetime-show-component.jsx'),
  );
  componentLoader.override(
    'RecordsTable',
    path.join(currentDirectory, 'components', 'scrollable-records-table-component.jsx'),
  );
  const components = {
    Dashboard: componentLoader.add('Dashboard', path.join(currentDirectory, 'dashboard', 'dashboard-component.jsx')),
    ModerationAction: componentLoader.add(
      'ModerationAction',
      path.join(currentDirectory, 'components', 'moderation-action-component.jsx'),
    ),
    ReferenceLink: componentLoader.add(
      'ReferenceLink',
      path.join(currentDirectory, 'components', 'reference-link-component.jsx'),
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
    PostReviewWorkspace: componentLoader.add(
      'PostReviewWorkspace',
      path.join(currentDirectory, 'components', 'post-review-workspace-component.jsx'),
    ),
    PostMediaPreview: componentLoader.add(
      'PostMediaPreview',
      path.join(currentDirectory, 'components', 'post-media-preview-component.jsx'),
    ),
    CommentEvidence: componentLoader.add(
      'CommentEvidence',
      path.join(currentDirectory, 'components', 'comment-evidence-component.jsx'),
    ),
    ProfilePhoto: componentLoader.add(
      'ProfilePhoto',
      path.join(currentDirectory, 'components', 'profile-photo-component.jsx'),
    ),
    ReportStatus: componentLoader.add(
      'ReportStatus',
      path.join(currentDirectory, 'components', 'report-status-component.jsx'),
    ),
    RecordStatus: componentLoader.add(
      'RecordStatus',
      path.join(currentDirectory, 'components', 'record-status-component.jsx'),
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
    attachPostDetailReviewWorkspace(buildRescuePostsResource(db, components), pool, components),
    attachPostDetailReviewWorkspace(buildLostPostsResource(db, components), pool, components),
    attachPostDetailReviewWorkspace(buildAdoptionPostsResource(db, components), pool, components),
    attachPostDetailReviewWorkspace(buildProductPostsResource(db, components), pool, components),
    attachPostDetailReviewWorkspace(buildMatingPostsResource(db, components), pool, components),
    buildPostMediaResource(db, components),
    buildPostUpvotesResource(db, components),
    buildPostSavesResource(db, components),
    buildPostReportsResource(db, components, pool, cache),
    buildCommentReportsResource(db, components, pool, cache),
    buildAccountReportsResource(db, components, pool, cache),
    buildCommentsResource(db, pool, components, cache),
    buildContactRequestsResource(db, components),
    buildAdoptionApplicationsResource(db, components),
    buildNotificationsResource(db, components),
    buildCitiesResource(db, components),
    buildVetClinicsResource(db, pool, components, cache),
    buildAdminUsersResource(db, components),
    buildModerationActionsResource(db, components, pool),
    buildVetClinicLocationAuditsResource(db, components),
  ];

  const resources = rawResources.map((resource) => {
    const properties = { ...resource.options.properties };
    for (const name of ['status', 'moderation_status', 'urgency', 'review_outcome']) {
      if (!properties[name]?.availableValues) continue;
      properties[name] = {
        ...properties[name],
        components: { ...properties[name].components, list: components.RecordStatus, show: components.RecordStatus },
      };
    }
    return attachPopulatedSanitizer(
      attachCacheInvalidation({ ...resource, options: { ...resource.options, properties } }, cache),
    );
  });

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
      styles: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', '/admin/assets/pupzy-theme.css'],
      scripts: ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'],
    },
    locale: {
      language: 'en',
      translations: {
        en: {
          actions: { show: 'Details', list: 'Records' },
          properties: PROPERTY_LABELS,
          resources: { posts: { actions: { show: 'Review Post', list: 'Posts' } } },
          components: {
            Login: {
              welcomeHeader: 'Welcome to Pupzy',
              welcomeMessage: 'Review Posts, follow reports and help keep the community safe.',
              loginButton: 'Sign in',
            },
          },
        },
      },
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
