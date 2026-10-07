# syntax=docker/dockerfile:1
#
# One image recipe for both apps. Build a target with:
#   docker build --target web    -t replyooo-web .
#   docker build --target worker -t replyooo-worker .
# The workspace packages ship TypeScript source, so only the Next.js app needs a build step;
# the worker runs through tsx.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Dependencies first, from the manifests alone, so source edits don't bust this layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/email/package.json packages/email/
COPY packages/engine/package.json packages/engine/
COPY packages/meta/package.json packages/meta/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
# env() is read lazily, so the build needs no production secrets.
RUN pnpm --filter @replyooo/web build

FROM web-build AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN chown -R node:node /app/apps/web/.next
USER node
WORKDIR /app/apps/web
EXPOSE 3000
# Run the binaries directly: no pnpm download at start-up, and node is PID 1 so it receives SIGTERM.
CMD ["node_modules/.bin/next", "start"]

# Also runs the one-shot migration job (compose overrides the command).
FROM source AS worker
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/worker
EXPOSE 3001
# node is PID 1 (with tsx as a loader) so the worker's SIGTERM handler can drain the queues.
CMD ["node", "--import", "tsx", "src/main.ts"]
