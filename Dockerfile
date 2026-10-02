# Build from repository ROOT: canonical HTML and its extraction scripts are required.
# Official runtime tag verified in Docker Hub's oven/bun tag listing; do not use latest.
FROM oven/bun:1.4.2 AS build
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile
COPY server/tsconfig.json ./
COPY server/src ./src
COPY scripts/run-server.mjs scripts/extract-enochian-engine.mjs scripts/client-baseline.mjs /app/scripts/
COPY enochian.html /app/enochian.html
RUN bun ../scripts/run-server.mjs build

FROM oven/bun:1.4.2 AS production-dependencies
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2 AS runtime
WORKDIR /app/server
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=production-dependencies --chown=bun:bun /app/server/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/server/dist ./dist
COPY --chown=bun:bun server/package.json ./
# Runtime verifies migration hashes and trusted TLS; startup never applies DDL.
COPY --chown=bun:bun server/migrations ./migrations
COPY --chown=bun:bun server/certs ./certs
# Same-origin demo/website: exact canonical pages, public endpoint injected at response time.
COPY --chown=bun:bun index.html enochian.html chaturaji.html /app/
USER bun
# Railway injects PORT; 2567 is only the application's ordinary local default.
EXPOSE 2567
CMD ["bun", "dist/index.js"]
