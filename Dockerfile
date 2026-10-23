# syntax=docker/dockerfile:1
FROM oven/bun:1 AS base
WORKDIR /app

# Install workspace dependencies once (cached while lockfile is unchanged)
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

COPY . .

# Front-end build served by the same process
RUN bun run build

# Download the embedding model and embed the knowledge base at build time
RUN bun apps/server/src/prewarm.ts

ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "apps/server/src/index.ts"]
