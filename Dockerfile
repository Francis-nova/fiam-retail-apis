# syntax=docker/dockerfile:1

# Builds all three Nest apps (auth, payment, postoffice) from this one
# monorepo into a single runtime image. Which app actually runs in a given
# container is decided by the `command:` override in docker/stack.yml, not
# by anything in this file — all three services in staging use this same
# image.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# tesseract.js (apps/auth's KYC OCR) resolves 'eng.traineddata' relative to
# the process cwd by default (no langPath/cachePath set in ocr.service.ts) —
# this ships the trained-data file locally so OCR works without an outbound
# fetch to the jsdelivr CDN on first use.
COPY --from=builder /app/eng.traineddata ./eng.traineddata

# Informational only — the actual bound port depends on which app's
# `command:` this container is running (7001 auth / 7002 postoffice / 7003
# payment), set via each service's *_PORT env var in docker/stack.yml.
EXPOSE 7001 7002 7003

CMD ["node", "dist/apps/auth/apps/auth/src/main.js"]
