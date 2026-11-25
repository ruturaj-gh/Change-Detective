FROM node:22-bookworm-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/scanner/package.json packages/scanner/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

FROM dependencies AS build

COPY . .

ARG NEXT_PUBLIC_API_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

RUN npm run build --workspace @change-detective/scanner \
    && npm run db:generate --workspace @change-detective/api \
    && npx tsc --build apps/api/tsconfig.json --force \
    && npm run build --workspace @change-detective/web

FROM base AS api

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/scripts ./apps/api/scripts
COPY --from=build /app/packages/scanner/package.json ./packages/scanner/package.json
COPY --from=build /app/packages/scanner/dist ./packages/scanner/dist

RUN mkdir -p /app/apps/api/data \
    && chown -R node:node /app/apps/api/data

WORKDIR /app/apps/api
USER node
EXPOSE 3001

CMD ["sh", "-c", "npm run db:migrate && node dist/server.js"]

FROM base AS web

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/web ./apps/web

RUN chown -R node:node /app/apps/web/.next

WORKDIR /app/apps/web
USER node
EXPOSE 3000

CMD ["npm", "run", "start"]
