FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
COPY scripts/generate-clients.mjs ./scripts/generate-clients.mjs
RUN node scripts/generate-clients.mjs

FROM dependencies AS web-build
ARG WEB_APP
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/build-web.mjs ./scripts/build-web.mjs
RUN node scripts/build-web.mjs "$WEB_APP" && cp -r "dist/$WEB_APP" /web-output

FROM nginx:1.28-alpine AS web
COPY infra/nginx/static.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /web-output /usr/share/nginx/html
EXPOSE 8080

FROM dependencies AS runtime-dependencies
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force

FROM base AS platform-api
ARG APP_REVISION=development
ENV NODE_ENV=production APP_REVISION=$APP_REVISION PORT=3101
WORKDIR /app
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/.generated/platform ./.generated/platform
COPY package.json tsconfig.json ./
COPY apps/platform-api ./apps/platform-api
COPY packages/contracts ./packages/contracts
COPY contracts/permissions.json ./contracts/permissions.json
USER node
CMD ["node","--import","tsx","apps/platform-api/src/main.ts"]

FROM base AS finance-api
ARG APP_REVISION=development
ENV NODE_ENV=production APP_REVISION=$APP_REVISION PORT=3102 UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/.generated/finance ./.generated/finance
COPY package.json tsconfig.json ./
COPY apps/finance-api ./apps/finance-api
COPY apps/platform-api/src/http.ts ./apps/platform-api/src/http.ts
COPY packages ./packages
COPY processors ./processors
RUN mkdir /app/uploads && chown node:node /app/uploads
USER node
CMD ["node","--import","tsx","apps/finance-api/src/main.ts"]

FROM finance-api AS finance-worker
COPY apps/finance-worker ./apps/finance-worker
CMD ["node","--import","tsx","apps/finance-worker/src/main.ts"]
