# --- Stage 1: build both workspaces (React frontend + Express/TS backend) ---
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci
COPY server ./server
COPY client ./client
# prisma generate (part of `npm run build`) needs DATABASE_URL to resolve,
# even though it never connects to it - the real value comes from
# docker-compose at container runtime.
ENV DATABASE_URL="file:./data/app.db"
RUN npm run build

# --- Stage 2: runtime - needs Chromium + its system deps for Playwright ---
FROM mcr.microsoft.com/playwright:v1.61.1-jammy AS runtime
WORKDIR /app
# Install from the committed lockfile so the runtime dependency tree is
# reproducible and identical to the one the build stage compiled against - a
# bare `npm i` re-resolved every range on each build. The lockfile spans both
# workspaces, so `npm ci` needs every workspace's package.json present even
# though only the server's dependencies are installed.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev --workspace server --include-workspace-root

WORKDIR /app/server
# Don't rely on the base image's baked-in browser cache matching whatever
# user/HOME this container actually runs as (varies by host/orchestrator) -
# install the exact browser build this playwright version needs, explicitly.
RUN npx playwright install --with-deps chromium

COPY --from=build /app/server/prisma ./prisma

RUN npx prisma generate

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./dist/public

# Stamped into GET /api/health so you can confirm in one curl which commit is
# actually serving traffic. Pass it at build time:
#   GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
