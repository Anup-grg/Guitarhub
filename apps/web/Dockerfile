FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build -w web

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
# Run as a non-root user (NFR-8 least privilege).
RUN addgroup -S app && adduser -S app -G app \
  && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "web"]
