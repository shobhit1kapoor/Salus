FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/testing/package.json packages/testing/package.json
RUN npm ci
COPY . .
ARG APP
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build -w @salus/${APP}
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start", "-w", "@salus/api"]
