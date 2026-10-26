# Stage 1: build TypeScript
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Stage 2: production image
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY templates ./templates
COPY cities.json ./

# Не root. Каталог сесії — єдине, куди процес пише (saveSession при першому вході).
RUN mkdir -p secrets && chown node:node secrets
USER node

EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5001}/api/status" >/dev/null || exit 1
CMD ["node", "dist/app.js"]
