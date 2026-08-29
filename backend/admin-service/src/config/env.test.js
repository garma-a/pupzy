import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateEnv } from "./env.js";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/pupzy",
  ADMIN_COOKIE_PASSWORD: "c".repeat(32),
  ADMIN_SESSION_SECRET: "s".repeat(32),
};

describe("environment validation", () => {
  it("applies safe development defaults and does not require REDIS_URL", () => {
    const env = validateEnv(valid);
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.PORT, 4000);
    assert.equal(env.ADMIN_ALLOWED_IPS, "");
    assert.equal("REDIS_URL" in env, false);
    assert.equal(env.MAP_TILE_URL, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    assert.ok(env.MAP_ATTRIBUTION.includes("OpenStreetMap"));
    assert.equal(env.EGYPT_MIN_LAT, 21.0);
    assert.equal(env.EGYPT_MAX_LAT, 32.0);
    assert.equal(env.EGYPT_MIN_LNG, 24.0);
    assert.equal(env.EGYPT_MAX_LNG, 37.5);
    // Confirm zero paid credentials required or exposed
    assert.equal("GOOGLE_MAPS_API_KEY" in env, false);
    assert.equal("GOOGLE_PLACES_API_KEY" in env, false);
    assert.equal("MAPBOX_ACCESS_TOKEN" in env, false);
  });

  it("reports all invalid secrets together", () => {
    assert.throws(
      () =>
        validateEnv({
          ...valid,
          ADMIN_COOKIE_PASSWORD: "short",
          ADMIN_SESSION_SECRET: "short",
        }),
      (error) =>
        error.message.includes("ADMIN_COOKIE_PASSWORD") &&
        error.message.includes("ADMIN_SESSION_SECRET"),
    );
  });
});
