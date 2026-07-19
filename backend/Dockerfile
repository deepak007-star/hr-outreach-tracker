FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts

RUN npm ci --omit=dev

# Install Playwright Chromium + all required system libraries.
# --with-deps handles apt-get for every OS dep Chromium needs.
RUN npx playwright install --with-deps chromium

COPY src ./src

RUN mkdir -p /app/data /app/uploads

EXPOSE 3001

CMD ["node", "src/index.js"]
