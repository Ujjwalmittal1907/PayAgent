import { Markup } from "telegraf";

export function approvalKeyboard(shortId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ APPROVE", `approve:${shortId}`), Markup.button.callback("❌ REJECT", `reject:${shortId}`)],
    [Markup.button.callback("🔍 View full address", `view:${shortId}`)],
  ]);
}
