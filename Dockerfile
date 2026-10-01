# The browser version: web app and proxy in one image.
#   docker compose up -d --build
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
# No install scripts: the Electron download they would trigger is only needed for the desktop app
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web

FROM node:22-slim
WORKDIR /app
COPY --from=build /src/dist-web ./dist-web
COPY --from=build /src/dist-proxy ./dist-proxy
USER node
ENV MUMH5_PORT=8080
EXPOSE 8080/tcp 3478/udp
CMD ["node", "dist-proxy/proxy.mjs"]
