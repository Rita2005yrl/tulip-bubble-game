FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data STATIC_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/game-engine.js ./game-engine.js
COPY --from=build /app/package.json ./package.json
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
