FROM node:22.21.0-bookworm-slim
WORKDIR /app
COPY chenchen/core/ /app/chenchen/core/
COPY chenchen/tools/ /app/chenchen/tools/
COPY chenchen/integrations/account-hub.js /app/chenchen/integrations/account-hub.js
COPY chenchen/integration/public-chat/*.mjs /app/chenchen/integration/public-chat/
COPY chenchen/integration/public-chat/app.html chenchen/integration/public-chat/review.js chenchen/integration/public-chat/review.css /app/chenchen/integration/public-chat/
COPY chenchen/deployment/submission-parallel-v1/*.mjs /app/chenchen/deployment/submission-parallel-v1/
WORKDIR /app/chenchen/deployment/submission-parallel-v1
RUN node build.mjs && mkdir -p /data && chown node:node /data
USER node
ENV BIND_HOST=0.0.0.0 PORT=4188
EXPOSE 4188
CMD ["node", "server.mjs"]
