FROM node:24-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p runtime && chown node:node runtime
USER node
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s CMD node -e "fetch('http://127.0.0.1:8000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
