FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace @gsw-mail/web --include-workspace-root
RUN npm run build --workspace @gsw-mail/web

FROM caddy:2.10-alpine
COPY apps/web/Caddyfile.railway /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
ENV PORT=8080
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
