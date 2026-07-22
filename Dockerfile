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
WORKDIR /app/server

COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/client/dist ./dist/public

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
