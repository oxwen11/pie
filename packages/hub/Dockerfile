# Build from the repository root: docker build -f packages/hub/Dockerfile .
FROM node:24-slim AS build
RUN npm install --global pnpm@12.6.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@getpie/hub..." \
  && pnpm --filter @getpie/hub exec tsdown

FROM node:24-slim
ENV NODE_ENV=production HUB_HOME=/data PORT=3000
RUN mkdir /data && chown node:node /data && chmod 700 /data
COPY --from=build /repo/packages/hub/dist/main.js /app/main.js
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/main.js"]
