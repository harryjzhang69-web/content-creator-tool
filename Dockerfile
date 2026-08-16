FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production --registry=https://registry.npmmirror.com

COPY server.js zhipuImage.js buddyCloudImage.js ./
COPY web ./web

ENV NODE_ENV=production
EXPOSE 5001

CMD ["node", "server.js"]
