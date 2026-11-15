# Mars viewer: Node server (serve.mjs) + static page. The server is required: it streams MOLA
# terrain (/terrain) for the route planner and proxies/caches NASA Trek tiles (/trek).
FROM node:22-slim
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY web/ ./
RUN mkdir -p data .tile-cache && chown -R node:node /app/web
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
USER node
CMD ["node", "serve.mjs", "--no-open"]
