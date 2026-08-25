import path from "node:path";
import { fileURLToPath } from "node:url";
import AdminJS, { ComponentLoader } from "adminjs";
import Adapter, { Database, Resource } from "@adminjs/sql";

import { DashboardStatsCache } from "./dashboard/dashboard-cache.js";
import { buildDashboardHandler } from "./dashboard/dashboard-handler.js";
import { buildAdminUsersResource } from "./resources/admin-users.resource.js";
import { buildAdoptionApplicationsResource } from "./resources/adoption-applications.resource.js";
import { buildAdoptionPostsResource } from "./resources/adoption-posts.resource.js";
import { buildCitiesResource } from "./resources/cities.resource.js";
import { buildContactRequestsResource } from "./resources/contact-requests.resource.js";
import { buildLostPostsResource } from "./resources/lost-posts.resource.js";
import { buildMatingPostsResource } from "./resources/mating-posts.resource.js";
import { buildModerationActionsResource } from "./resources/moderation-actions.resource.js";
import { buildNotificationsResource } from "./resources/notifications.resource.js";
import { buildPostMediaResource } from "./resources/post-media.resource.js";
import { buildPostReportsResource } from "./resources/post-reports.resource.js";
import { buildPostSavesResource } from "./resources/post-saves.resource.js";
import { buildPostUpvotesResource } from "./resources/post-upvotes.resource.js";
import { buildPostsResource } from "./resources/posts.resource.js";
import { buildProductPostsResource } from "./resources/product-posts.resource.js";
import { buildRescuePostsResource } from "./resources/rescue-posts.resource.js";
import { attachCacheInvalidation } from "./resources/resource-helpers.js";
import { buildSavedSearchesResource } from "./resources/saved-searches.resource.js";
import { buildUsersResource } from "./resources/users.resource.js";
import { buildVetClinicsResource } from "./resources/vet-clinics.resource.js";

AdminJS.registerAdapter({ Database, Resource });

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
    Dashboard: componentLoader.add(
      "Dashboard",
      path.join(currentDirectory, "dashboard", "dashboard-component.jsx"),
    ),
    ModerationAction: componentLoader.add(
      "ModerationAction",
      path.join(
        currentDirectory,
        "components",
        "moderation-action-component.jsx",
      ),
    ),
  };

  const db = await new Adapter("postgresql", {
    connectionString: databaseUrl,
    database: databaseName,
    statement_timeout: 8_000,
    application_name: "pupzy-adminjs-sql",
  }).init();

  const knex = db.table("users").knex;
  if (knex?.client?.pool) {
    knex.client.pool.min = 0;
    knex.client.pool.max = 3;
    knex.client.pool.idleTimeoutMillis = 10_000;
  }

  const rawResources = [
    buildUsersResource(db, pool, components, cache),
    buildPostsResource(db, pool, components, cache),
    buildRescuePostsResource(db),
    buildLostPostsResource(db),
    buildAdoptionPostsResource(db),
    buildProductPostsResource(db),
    buildMatingPostsResource(db),
    buildPostMediaResource(db),
    buildPostUpvotesResource(db),
    buildPostSavesResource(db),
    buildPostReportsResource(db),
    buildContactRequestsResource(db),
    buildAdoptionApplicationsResource(db),
    buildSavedSearchesResource(db),
    buildNotificationsResource(db),
    buildCitiesResource(db),
    buildVetClinicsResource(db),
    buildAdminUsersResource(db),
    buildModerationActionsResource(db),
  ];

  const resources = rawResources.map((resource) =>
    attachCacheInvalidation(resource, cache),
  );

  const dashboardHandler = buildDashboardHandler(pool, cache);
  const admin = new AdminJS({
    rootPath: "/admin",
    branding: { companyName: "Pupzy Admin", withMadeWithLove: false },
    componentLoader,
    resources,
    dashboard: {
      component: components.Dashboard,
      handler: dashboardHandler,
    },
  });

  return {
    admin,
    sqlAdapterPool: knex,
    cache,
    closeDashboard: () => {},
  };
}
