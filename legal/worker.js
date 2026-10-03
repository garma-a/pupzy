export default {
  async fetch(request, env) {
    // Attempt to serve from Cloudflare static assets
    const response = await env.ASSETS.fetch(request);

    // If not found in the legal assets, fall back to the GoDaddy origin server
    if (response.status === 404) {
      return fetch(request);
    }

    return response;
  },
};
