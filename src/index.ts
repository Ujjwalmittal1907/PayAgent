import Fastify from "fastify";
import { env } from "./config/env.js";
import { buildBot } from "./bot/bot.js";
import { registerRoutes } from "./server/routes.js";

async function main() {
  const app = Fastify({ logger: true });
  await registerRoutes(app);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`[payagent] API on :${env.PORT}`);

  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn("[payagent] TELEGRAM_BOT_TOKEN missing — API only. Copy .env.example to .env");
    return;
  }
  const bot = buildBot();
  // NOTE: Telegraf's launch() drives an infinite long-polling loop and its
  // promise never resolves by design — do NOT await it before logging.
  bot.launch(() => console.log("[payagent] Telegram bot connected")).catch((e) => {
    console.error("[payagent] bot launch failed", e);
    process.exit(1);
  });
  console.log("[payagent] Telegram bot polling started");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
