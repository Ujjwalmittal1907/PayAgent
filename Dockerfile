FROM node:22-slim
RUN npm i -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
RUN pnpm exec prisma generate
COPY . .
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 8788
CMD ["sh", "-c", "pnpm exec prisma db push --accept-data-loss && node dist/src/index.js"]
