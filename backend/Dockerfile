FROM node:20-bookworm-slim

WORKDIR /app

# Copy install script BEFORE npm ci so postinstall can run it
COPY package.json package-lock.json ./
COPY scripts ./scripts

RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p /app/data /app/uploads

EXPOSE 3001

CMD ["node", "src/index.js"]
