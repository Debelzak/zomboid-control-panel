# Zomboid Control Panel - Docker
FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better cache)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci

# Copy source
COPY server/ ./server/
COPY client/ ./client/

# Build frontend
RUN cd client && npm run build

# Create runtime directories
RUN mkdir -p data logs

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
