FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production

USER pwuser

CMD ["node", "dist/index.js"]
