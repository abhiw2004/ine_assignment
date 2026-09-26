# Backend image with Chromium preinstalled so Playwright scraping works on
# Render (the native Node runtime has no browser system libraries).
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    SCRAPE_CONCURRENCY=1

# Install app deps first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# The playwright base image already ships browsers under /ms-playwright.
EXPOSE 8080
CMD ["node", "src/server.js"]
