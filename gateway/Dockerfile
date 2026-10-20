FROM node:24-alpine
WORKDIR /app/gateway
COPY gateway/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY gateway/src ./src
COPY shared/slack-gateway /app/shared/slack-gateway
RUN mkdir /data && chown node:node /data
ENV GATEWAY_DATA_DIR=/data PORT=8080
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
