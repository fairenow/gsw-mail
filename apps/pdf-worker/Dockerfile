FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium poppler-utils fonts-dejavu-core tini \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 10001 pdfworker && useradd --uid 10001 --gid 10001 --create-home pdfworker
WORKDIR /worker
COPY apps/pdf-worker/server.mjs /worker/server.mjs
USER pdfworker
ENV NODE_ENV=production PORT=4001
EXPOSE 4001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
