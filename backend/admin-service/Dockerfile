FROM node:22-alpine
WORKDIR /app
COPY admin-service/package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node admin-service/ .
# The AdminJS service and main API intentionally share this single contract.
# Build with the repository root as context so production receives the same file.
COPY --chown=node:node src/common/contracts/google-maps-handoff.contract.ts /src/common/contracts/google-maps-handoff.contract.ts
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"
ENV ADMIN_JS_TMP_DIR=/tmp/adminjs
EXPOSE 4000
USER node
CMD ["node", "src/main.js"]
