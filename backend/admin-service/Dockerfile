FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"
ENV ADMIN_JS_TMP_DIR=/tmp/adminjs
EXPOSE 4000
USER node
CMD ["node", "src/main.js"]
