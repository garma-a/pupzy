import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ipAllowlist } from "./ip-allowlist.js";
import { requireSameOrigin } from "./same-origin.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function request(method, headers = {}) {
  return {
    method,
    ip: "127.0.0.1",
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

describe("security middleware", () => {
  it("allows safe methods without origin headers", () => {
    let nextCalled = false;
    requireSameOrigin(request("GET"), responseRecorder(), () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("allows same-origin writes and rejects cross-origin or unverifiable writes", () => {
    for (const headers of [
      { origin: "https://admin.example.com", host: "admin.example.com" },
      { "sec-fetch-site": "same-origin", host: "admin.example.com" },
    ]) {
      let nextCalled = false;
      requireSameOrigin(request("POST", headers), responseRecorder(), () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
    }

    for (const headers of [
      { origin: "https://attacker.example", host: "admin.example.com" },
      {},
    ]) {
      const response = responseRecorder();
      requireSameOrigin(request("POST", headers), response, () =>
        assert.fail("must reject"),
      );
      assert.equal(response.statusCode, 403);
    }
  });

  it("enforces the configured IP allowlist", () => {
    let nextCalled = false;
    ipAllowlist(["127.0.0.1"])(request("GET"), responseRecorder(), () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);

    const denied = responseRecorder();
    const deniedRequest = { ...request("GET"), ip: "203.0.113.9" };
    ipAllowlist(["127.0.0.1"])(deniedRequest, denied, () =>
      assert.fail("must reject"),
    );
    assert.equal(denied.statusCode, 403);
  });
});
