import http from "k6/http";
import { check, sleep } from "k6";

const API_URL = __ENV.API_URL || __ENV.BASE_URL || "http://localhost:3000";
const ADMIN_URL = __ENV.ADMIN_URL || "http://localhost:4000";

export const options = {
  scenarios: {
    public_api_baseline: {
      executor: "constant-arrival-rate",
      rate: 500,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 150,
      maxVUs: 1000,
      exec: "publicApiRequest",
    },
    concurrent_admin_load: {
      executor: "constant-vus",
      vus: 5,
      duration: "2m",
      exec: "adminRequest",
    },
  },
  thresholds: {
    "http_req_failed{scenario:public_api_baseline}": ["rate<0.01"],
    "http_req_duration{scenario:public_api_baseline}": ["p(95)<2000"],
  },
};

const citiesQuery = JSON.stringify({
  query: "query GetCities { cities { id nameEnglish nameArabic governorate } }",
});

export function setup() {
  if (!__ENV.ADMIN_EMAIL || !__ENV.ADMIN_PASSWORD) return { adminCookie: null };

  const login = http.post(
    `${ADMIN_URL}/admin/login`,
    { email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD },
    { redirects: 0, headers: { Origin: ADMIN_URL } },
  );
  check(login, {
    "admin login redirects after success": (response) =>
      response.status === 302,
  });
  const cookie = Object.entries(login.cookies)
    .flatMap(([name, values]) =>
      values.slice(0, 1).map(({ value }) => `${name}=${value}`),
    )
    .join("; ");
  return { adminCookie: cookie || null };
}

export function publicApiRequest() {
  const response = http.post(`${API_URL}/graphql`, citiesQuery, {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "cities" },
  });
  check(response, {
    "public API status is 200": (result) => result.status === 200,
  });
}

export function adminRequest(data) {
  const path = data.adminCookie ? "/admin/api/dashboard" : "/health";
  const response = http.get(`${ADMIN_URL}${path}`, {
    headers: data.adminCookie ? { Cookie: data.adminCookie } : {},
    tags: { endpoint: "admin-dashboard" },
  });
  check(response, {
    "admin request succeeds": (result) => result.status === 200,
  });
  sleep(1);
}
