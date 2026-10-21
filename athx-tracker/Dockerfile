# syntax=docker/dockerfile:1

# Build tools are present so better-sqlite3 can compile from source when no
# prebuilt binary matches the host architecture, such as an ARM box.
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./

FROM base AS prod-deps
RUN npm ci --omit=dev

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
# Passed by CI so /api/version can report which commit is running.
ARG BUILD_SHA=unknown
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  DATABASE_FILE=/data/athx.db \
  BUILD_SHA=${BUILD_SHA}

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# The migrations ship with the image: a fresh volume builds its own tables.
COPY --from=build /app/drizzle ./drizzle
COPY package.json next.config.mjs ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
