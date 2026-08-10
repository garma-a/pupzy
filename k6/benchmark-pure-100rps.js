import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    constant_100_rps: {
      executor: 'constant-arrival-rate',
      rate: 100, // Exactly 100 req/sec
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 30,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

const gqlCitiesQuery = JSON.stringify({
  query: `query GetCities { cities { id governorate } }`,
});

const gqlHeaders = {
  'Content-Type': 'application/json',
};

export default function () {
  if (Math.random() < 0.5) {
    const res = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
    check(res, { 'status 200': (r) => r.status === 200 });
  } else {
    const res = http.post(`${BASE_URL}/graphql`, gqlCitiesQuery, {
      headers: gqlHeaders,
      tags: { name: 'graphql' },
    });
    check(res, { 'status 200': (r) => r.status === 200 });
  }
}
