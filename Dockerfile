FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

ARG VITE_BASE_URL=http://localhost:3000
ENV VITE_BASE_URL=$VITE_BASE_URL
RUN pnpm build

####
# The app is still a static SPA; the server exists so crawlers get per-link OpenGraph tags and a
# rendered card, neither of which a JS-less crawler could ever get from the SPA itself
FROM node:24-alpine
WORKDIR /app

# curl for healthchecks. The OG rasterizer needs no system fonts: it ships its own (see
# server/assets/fonts)
RUN apk add --no-cache curl

COPY --from=builder /app/.output ./.output

ARG VITE_BASE_URL=http://localhost:3000
# Absolute URLs in the OpenGraph tags; override at runtime when the public origin differs from
# the one the request arrives with
ENV PUBLIC_BASE_URL=$VITE_BASE_URL
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
