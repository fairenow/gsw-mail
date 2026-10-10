FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM build AS migrate
WORKDIR /app/apps/api
CMD ["npm", "run", "db:migrate"]

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils chromium fonts-dejavu-core \
    libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress \
    python3 python3-openpyxl \
    imagemagick tesseract-ocr \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace apps/api --ignore-scripts && npm cache clean --force
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle apps/api/drizzle
COPY apps/web/public/logo.png /app/apps/api/assets/brand-original.png
RUN convert /app/apps/api/assets/brand-original.png -resize 128x128 -strip /app/apps/api/assets/brand-logo.png
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
