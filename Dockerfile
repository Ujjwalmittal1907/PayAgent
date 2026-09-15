FROM node:22-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
RUN pnpm exec prisma generate
COPY . .
RUN pnpm build
ENV NODE_ENV=production
# Sensible default so the container boots even if the volume var is forgotten.
# Override in Railway Variables with file:/app/data/prod.db (+ secrets below, which have no defaults).
ENV DATABASE_URL="file:/app/data/prod.db"
EXPOSE 8788
CMD ["sh", "-c", "pnpm exec prisma db push --accept-data-loss && node dist/src/index.js"]
