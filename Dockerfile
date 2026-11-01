FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3030 DATA_DIR=/data
# /data holds leads, opt-outs and call history. It MUST be a persistent disk/volume.
VOLUME /data
EXPOSE 3030
CMD ["node", "src/server.mjs"]
