import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ipAllowlist } from './ip-allowlist.js';
import { buildCsrfProtection } from './csrf.js';
import { requireSameOrigin } from './same-origin.js';
import { buildRequestTriggeredSessionPruning } from './session-pruning.js';

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
    cookie(name, value, options) {
      this.cookieValue = { name, value, options };
      return this;
    },
  };
}

function request(method, headers = {}) {
  return {
    method,
    ip: '127.0.0.1',
    protocol: 'https',
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

describe('security middleware', () => {
  it('allows safe methods without origin headers', () => {
    let nextCalled = false;
    requireSameOrigin(request('GET'), responseRecorder(), () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it('allows same-origin writes and rejects cross-origin or unverifiable writes', () => {
    for (const headers of [
      { origin: 'https://admin.example.com', host: 'admin.example.com' },
      { 'sec-fetch-site': 'same-origin', host: 'admin.example.com' },
      { origin: 'null', 'sec-fetch-site': 'same-origin', host: 'admin.example.com' },
      { referer: 'https://admin.example.com/admin/login', host: 'admin.example.com' },
    ]) {
      let nextCalled = false;
      requireSameOrigin(request('POST', headers), responseRecorder(), () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);
    }

    for (const headers of [
      { origin: 'https://attacker.example', host: 'admin.example.com' },
      { origin: 'http://admin.example.com', host: 'admin.example.com' },
      { origin: 'null', host: 'admin.example.com' },
      { 'sec-fetch-site': 'same-site', host: 'admin.example.com' },
      {},
    ]) {
      const response = responseRecorder();
      requireSameOrigin(request('POST', headers), response, () => assert.fail('must reject'));
      assert.equal(response.statusCode, 403);
    }
  });

  it('requires a signed double-submit token for AdminJS API writes', () => {
    const csrf = buildCsrfProtection('test-secret', { secure: true });
    const getResponse = responseRecorder();
    csrf({ ...request('GET'), path: '/' }, getResponse, () => {});

    const token = getResponse.cookieValue.value;
    assert.equal(getResponse.cookieValue.name, 'XSRF-TOKEN');
    assert.deepEqual(getResponse.cookieValue.options, {
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
      path: '/admin',
    });

    let nextCalled = false;
    csrf(
      {
        ...request('POST', {
          cookie: `XSRF-TOKEN=${encodeURIComponent(token)}`,
          'x-xsrf-token': token,
        }),
        path: '/api/resources/posts/actions/edit',
      },
      responseRecorder(),
      () => {
        nextCalled = true;
      },
    );
    assert.equal(nextCalled, true);

    for (const headers of [{}, { cookie: `XSRF-TOKEN=${encodeURIComponent(token)}`, 'x-xsrf-token': 'tampered' }]) {
      const response = responseRecorder();
      csrf({ ...request('POST', headers), path: '/api/resources/posts/actions/edit' }, response, () =>
        assert.fail('must reject'),
      );
      assert.equal(response.statusCode, 403);
    }
  });

  it('enforces the configured IP allowlist', () => {
    let nextCalled = false;
    ipAllowlist(['127.0.0.1'])(request('GET'), responseRecorder(), () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);

    const denied = responseRecorder();
    const deniedRequest = { ...request('GET'), ip: '203.0.113.9' };
    ipAllowlist(['127.0.0.1'])(deniedRequest, denied, () => assert.fail('must reject'));
    assert.equal(denied.statusCode, 403);
  });

  it('prunes expired sessions at most once per interval without a background timer', () => {
    let now = 1_000;
    let prunes = 0;
    const prune = buildRequestTriggeredSessionPruning(
      {
        pruneSessions: (callback) => {
          prunes += 1;
          callback();
        },
      },
      { clock: () => now, intervalMs: 500 },
    );

    prune(request('GET'), responseRecorder(), () => {});
    prune(request('GET'), responseRecorder(), () => {});
    assert.equal(prunes, 1);

    now += 500;
    prune(request('GET'), responseRecorder(), () => {});
    assert.equal(prunes, 2);
  });
});
