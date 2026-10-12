FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build -w api

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Run as a non-root user (NFR-8 least privilege).
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p .local-objects \
  && chown -R app:app /app
USER app
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/index.js"]
