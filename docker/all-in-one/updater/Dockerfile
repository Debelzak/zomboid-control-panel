FROM docker:27-cli

RUN apk add --no-cache nodejs curl tar docker-cli-compose

WORKDIR /controller
COPY docker/all-in-one/updater/server.js ./server.js

EXPOSE 3100
CMD ["node", "server.js"]