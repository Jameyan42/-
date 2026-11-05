FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npx tsc --noEmit -p tsconfig.server.json
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/package*.json ./
# tsx is required to reuse the existing TypeScript rule modules without changing their frozen sources.
RUN npm ci --omit=dev
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/.data/files && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8780 FILE_STORAGE_DIR=/app/.data/files
EXPOSE 8780
CMD ["node","--import","tsx","server/index.ts"]
