import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    phase_1_100_rps: {
      executor: 'constant-arrival-rate',
      rate: 100, // Target 100 req/sec
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 30,
      maxVUs: 100,
    },
    phase_2_150_rps: {
      executor: 'constant-arrival-rate',
      rate: 150, // Target 150 req/sec
      timeUnit: '1s',
      startTime: '1m',
      duration: '1m',
      preAllocatedVUs: 50,
      maxVUs: 150,
    },
    phase_3_200_rps: {
      executor: 'constant-arrival-rate',
      rate: 200, // Target 200 req/sec
      timeUnit: '1s',
      startTime: '2m',
      duration: '1m',
      preAllocatedVUs: 70,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // error rate < 1%
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
  },
};

const gqlCitiesQuery = JSON.stringify({
  query: `query GetCities { cities { id nameEnglish nameArabic governorate } }`,
});

const gqlHeaders = {
  'Content-Type': 'application/json',
};

export default function () {
  // Mix of REST health probe (20%) and GraphQL query (80%)
  if (Math.random() < 0.2) {
    const res = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else {
    const res = http.post(`${BASE_URL}/graphql`, gqlCitiesQuery, {
      headers: gqlHeaders,
      tags: { name: 'graphql_cities' },
    });
    check(res, { 'status is 200': (r) => r.status === 200 });
  }
}
