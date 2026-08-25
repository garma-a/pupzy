# Stage 1: Build NestJS Application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build production bundle
RUN npm run build

# Stage 2: Production Runtime Image
FROM node:22-alpine AS runner

WORKDIR /app

# Production environment settings
ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application, GraphQL schema files, and migration files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

# Restrict V8 heap limit to 150MB so memory usage stays tightly below 200MB limit
ENV NODE_OPTIONS="--max-old-space-size=150"

EXPOSE 3000

# Start NestJS production server
CMD ["node", "dist/src/main"]
