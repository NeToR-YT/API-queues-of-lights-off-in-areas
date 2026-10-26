# Stage 1: збірка React-застосунку
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: лише статика + nginx. Конфіг nginx монтується з репо (docker-compose.yml),
# щоб правити його без перезбирання образу.
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
