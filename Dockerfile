FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY . .
ENV NODE_ENV=production
RUN mkdir -p /app/out && chown -R bun:bun /app
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
