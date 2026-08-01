FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json drizzle.config.ts ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:25-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S stentor && adduser -S -G stentor stentor
COPY --from=build --chown=stentor:stentor /app/package.json /app/package-lock.json ./
COPY --from=build --chown=stentor:stentor /app/node_modules ./node_modules
COPY --from=build --chown=stentor:stentor /app/dist ./dist
COPY --chown=stentor:stentor drizzle ./drizzle
USER stentor
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/health/ready >/dev/null || exit 1
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
