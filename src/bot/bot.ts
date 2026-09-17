import { Telegraf, type Context } from "telegraf";
import { message } from "telegraf/filters";
import { env } from "../config/env.js";
import { parsePaymentText, parseWithLLM } from "../ai/intent-parser.js";
import { createProposal, executeProposal } from "../payments/payment-service.js";
import { recordApproval } from "../payments/approval-service.js";
import { db, spentTodayCents } from "../database/prisma.js";
import { audit } from "../audit/audit-service.js";
import { KeeperHubClient } from "../integrations/keeperhub/client.js";
import { encryptSecret, keyPrefix } from "../utils/crypto.js";
import { approvalKeyboard } from "./keyboards.js";
import { helpText, keeperText, policyText, proposalSummary, connectRequiredText } from "./messages.js";
import { escHtml } from "../utils/validation.js";
import { getExplorerTxUrl } from "../blockchain/explorer.js";
import { getBalances } from "../blockchain/client.js";

async function resolveIntent(text: string) {
  const direct = parsePaymentText(text);
  if (direct.intent) return direct;
  if (env.AI_API_KEY) {
    const llm = await parseWithLLM(text, env.AI_API_KEY, env.AI_MODEL);
    if (llm) return { intent: llm };
  }
  return direct;
}

async function handlePaymentRequest(
  ctx: Context,
  text: string,
  opts: { chatId: string; messageId: number; userId: string; username?: string },
) {
  const parsed = await resolveIntent(text);
  if (!parsed.intent) {
    await ctx.reply("I need:\n• amount\n• token\n• recipient address\n\nExample:\n/pay 0.50 USDC 0x...");
    return;
  }
  const i = parsed.intent;
  try {
    const { proposal, policy, dryRunError } = await createProposal({
      telegramUserId: opts.userId,
      telegramUsername: opts.username,
      telegramChatId: opts.chatId,
      telegramMessageId: opts.messageId,
      amount: i.amount,
      token: i.token,
      recipient: i.recipient,
      chain: i.network,
      purpose: i.purpose ?? null,
    });

    await ctx.replyWithHTML(proposalSummary(proposal));
    await ctx.replyWithHTML(policyText(policy.checks));

    if (!policy.allowed) {
      await ctx.replyWithHTML(`❌ <b>PAYMENT BLOCKED</b>\nReason: ${escHtml(policy.reason ?? "policy rejected")}\nNo KeeperHub execution happened.`);
      return;
    }
    if (dryRunError || proposal.status === "DRY_RUN_FAILED") {
      await ctx.replyWithHTML(keeperText(false, dryRunError));
      return;
    }
    await ctx.replyWithHTML(keeperText(true));

    if (proposal.status === "PENDING_APPROVAL") {
      await ctx.replyWithHTML(
        `🔐 <b>HUMAN APPROVAL REQUIRED</b>\n${escHtml(proposal.amount)} ${escHtml(proposal.token)} — approval ${proposal.approvalCount}/${proposal.requiredApprovals}`,
        approvalKeyboard(proposal.shortId),
      );
      return;
    }
    // auto-approve path
    await ctx.reply(`⏳ Executing via KeeperHub...`);
    try {
      const out = await executeProposal(proposal.id);
      const link = out.txHash ? getExplorerTxUrl(proposal.chain, out.txHash) : "";
      await ctx.replyWithHTML(
        `✅ <b>EXECUTED</b>\nTX: <code>${escHtml(out.txHash ?? "n/a")}</code>\n${link ? `<a href="${link}">View on explorer</a>` : ""}\nExecution: <code>${escHtml(String(out.executionId ?? ""))}</code>`,
      );
    } catch (e) {
      await ctx.reply(`❌ Execution failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("CONNECT_REQUIRED")) {
      await ctx.replyWithHTML(connectRequiredText());
      return;
    }
    await ctx.reply(`❌ ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function buildBot(): Telegraf {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.start((ctx) => ctx.replyWithHTML(helpText()));
  bot.help((ctx) => ctx.replyWithHTML(helpText()));
  bot.command("help", (ctx) => ctx.replyWithHTML(helpText()));

  bot.command("policy", (ctx) =>
    ctx.replyWithHTML(
      `<b>POLICY</b>\nAuto ≤ $${env.PAYMENT_AUTO_APPROVE_LIMIT_USD}\nHuman $${env.PAYMENT_AUTO_APPROVE_LIMIT_USD}–$${env.PAYMENT_HUMAN_APPROVAL_LIMIT_USD}\nReject &gt; $${env.PAYMENT_HUMAN_APPROVAL_LIMIT_USD}\nDaily $${env.PAYMENT_DAILY_LIMIT_USD}\nTokens: ${escHtml(env.ALLOWED_TOKENS)}\nNetworks: ${escHtml(env.ALLOWED_NETWORKS)}`,
    ),
  );

  bot.command("pay", async (ctx) => {
    const text = ctx.message && "text" in ctx.message ? ctx.message.text.replace(/^\/pay(@\w+)?\s*/, "") : "";
    await handlePaymentRequest(ctx, text, {
      chatId: String(ctx.chat!.id),
      messageId: ctx.message!.message_id,
      userId: String(ctx.from?.id ?? "unknown"),
      username: ctx.from?.username,
    });
  });

  bot.command("balance", async (ctx) => {
    const parts = ctx.message && "text" in ctx.message ? ctx.message.text.split(/\s+/) : [];
    const addr = parts[1];
    const chain = (parts[2] ?? "ethereum-sepolia").toLowerCase();
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return ctx.reply("Usage: /balance 0xWALLET [ethereum-sepolia|base-sepolia]");
    try {
      const b = await getBalances(addr as `0x${string}`, chain);
      await ctx.replyWithHTML(`<b>BALANCE (${escHtml(chain)})</b>\nWallet: <code>${escHtml(addr)}</code>\nUSDC: <code>${escHtml(b.usdc)}</code>\nETH: <code>${escHtml(b.eth)}</code>`);
    } catch (e) {
      await ctx.reply(`Balance lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  bot.command("pending", async (ctx) => {
    const rows = await db().paymentProposal.findMany({ where: { status: "PENDING_APPROVAL" }, orderBy: { createdAt: "desc" }, take: 10 });
    if (!rows.length) return ctx.reply("No pending approvals.");
    for (const p of rows) {
      await ctx.replyWithHTML(proposalSummary(p as never), approvalKeyboard(p.shortId));
    }
  });

  bot.command("history", async (ctx) => {
    const rows = await db().paymentProposal.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { executions: true } });
    if (!rows.length) return ctx.reply("No payments yet.");
    const lines = rows.map((p) => {
      const tx = (p.executions as { txHash: string | null }[]).find((e) => e.txHash)?.txHash;
      return `#${p.shortId} ${p.amount} ${p.token} → ${p.recipient.slice(0, 10)}... ${p.status}${tx ? ` TX:${tx.slice(0, 12)}...` : ""}${p.status === "POLICY_REJECTED" ? " ❌ BLOCKED" : ""}`;
    });
    await ctx.reply(`PAYMENT HISTORY\n\n${lines.join("\n")}`);
  });

  bot.command("status", async (ctx) => {
    const parts = ctx.message && "text" in ctx.message ? ctx.message.text.split(/\s+/) : [];
    const id = (parts[1] ?? "").replace(/^#/, "");
    if (!id) return ctx.reply("Usage: /status P-101");
    const p = await db().paymentProposal.findUnique({ where: { shortId: id }, include: { executions: true, auditEvents: true, approvals: true } });
    if (!p) return ctx.reply("Not found.");
    const tx = (p.executions as { txHash: string | null }[]).find((e) => e.txHash)?.txHash;
    await ctx.replyWithHTML(
      `${proposalSummary(p as never)}\n\nKeeperHub executions: ${p.executions.length}\nTx: ${tx ? `<code>${escHtml(tx)}</code>\n<a href="${getExplorerTxUrl(p.chain, tx)}">explorer</a>` : "—"}\nAudit events: ${p.auditEvents.length}\nApprovals: ${p.approvals.length}`,
    );
  });

  bot.command("connect", async (ctx) => {
    const parts = ctx.message && "text" in ctx.message ? ctx.message.text.split(/\s+/) : [];
    const key = (parts[1] ?? "").trim();
    if (!key.startsWith("kh_")) return ctx.reply("Usage: /connect kh_yourKeeperHubKey\nGet one at app.keeperhub.com → Settings → Developer → API keys.\n⚠️ Do this in a private chat, then delete your message.");
    if (!env.ENCRYPTION_KEY) return ctx.reply("❌ Server missing ENCRYPTION_KEY — admin must set it before /connect works.");
    const userId = String(ctx.from?.id ?? "unknown");
    try {
      const probe = new KeeperHubClient(key);
      await probe.verifyKey();
      // Discover the key's wallet via a harmless dry-run (never broadcasts).
      // Success and underfunded-failure responses both carry `from`.
      let wallet: string | null = null;
      try {
        const sim = (await probe.dryRunTransfer({
          chainId: "11155111",
          recipientAddress: "0x000000000000000000000000000000000000dEaD",
          amount: "0.01",
          tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        })) as { from?: string };
        if (sim.from) wallet = sim.from;
      } catch (e) {
        const m = /(\{"success".*\})/s.exec(e instanceof Error ? e.message : "");
        if (m) {
          try {
            const obj = JSON.parse(m[1]) as { from?: string };
            if (obj.from) wallet = obj.from;
          } catch { /* non-fatal */ }
        }
      }
      let user = await db().user.findUnique({ where: { telegramUserId: userId } });
      if (!user)
        user = await db().user.create({ data: { telegramUserId: userId, telegramUsername: ctx.from?.username } });
      await db().user.update({
        where: { id: user.id },
        data: { keeperKeyEnc: encryptSecret(key), keeperWallet: wallet, connectedAt: new Date() },
      });
      await audit(null, "WALLET_CONNECTED", { telegramUserId: userId, keyPrefix: keyPrefix(key), wallet });
      let bal = "";
      if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        try {
          const b = await getBalances(wallet as `0x${string}`, "ethereum-sepolia");
          bal = `\nUSDC: <code>${escHtml(b.usdc)}</code>\nETH: <code>${escHtml(b.eth)}</code>`;
        } catch { /* non-fatal */ }
      }
      await ctx.replyWithHTML(
        `🔗 <b>CONNECTED — you now pay from your own wallet</b>\nWallet: ${wallet ? `<code>${escHtml(wallet)}</code>` : "detected at first payment"}${bal}\nKey: <code>${escHtml(keyPrefix(key))}…</code>\n\nNow delete your /connect message. Run /disconnect anytime to remove the key.`,
      );
    } catch (e) {
      await ctx.reply(`❌ Key rejected: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
    }
  });

  bot.command("disconnect", async (ctx) => {
    const userId = String(ctx.from?.id ?? "unknown");
    const user = await db().user.findUnique({ where: { telegramUserId: userId } });
    if (!user?.keeperKeyEnc) return ctx.reply("Not connected. Everyone shares the desk wallet by default.");
    await db().user.update({ where: { id: user.id }, data: { keeperKeyEnc: null, keeperWallet: null, connectedAt: null } });
    await audit(null, "WALLET_DISCONNECTED", { telegramUserId: userId });
    await ctx.reply("🔌 Disconnected — you're back on the shared desk wallet.");
  });

  bot.command("whoami", async (ctx) => {
    const userId = String(ctx.from?.id ?? "unknown");
    const user = await db().user.findUnique({ where: { telegramUserId: userId } });
    if (!user?.keeperKeyEnc) {
      return ctx.replyWithHTML(connectRequiredText());
    }
    const scope = "user";
    const spent = await spentTodayCents("user", user.id);
    let bal = "";
    if (user.keeperWallet && /^0x[a-fA-F0-9]{40}$/.test(user.keeperWallet)) {
      try {
        const b = await getBalances(user.keeperWallet as `0x${string}`, "ethereum-sepolia");
        bal = `\nUSDC: <code>${escHtml(b.usdc)}</code> | ETH: <code>${escHtml(b.eth)}</code>`;
      } catch { /* non-fatal */ }
    }
    await ctx.replyWithHTML(
      `<b>WHOAMI</b>\nMode: own wallet (${scope}) ✅\nWallet: <code>${escHtml(user.keeperWallet ?? "unknown")}</code>${bal}\nYour spend today: $${Number(spent) / 100}`,
    );
  });

  bot.command("cancel", async (ctx) => {    const parts = ctx.message && "text" in ctx.message ? ctx.message.text.split(/\s+/) : [];
    const id = (parts[1] ?? "").replace(/^#/, "");
    if (!id) return ctx.reply("Usage: /cancel P-101");
    const p = await db().paymentProposal.findUnique({ where: { shortId: id } });
    if (!p) return ctx.reply("Not found.");
    if (["SUCCESS", "FAILED", "CANCELLED", "EXPIRED"].includes(p.status)) return ctx.reply(`Already terminal: ${p.status}`);
    await db().paymentProposal.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
    await audit(p.id, "PAYMENT_REJECTED", { reason: "cancelled by user" });
    await ctx.reply(`Cancelled ${p.shortId}.`);
  });

  bot.action(/^approve:(.+)$/, async (ctx) => {
    const shortId = ctx.match[1];
    const p = await db().paymentProposal.findUnique({ where: { shortId } });
    if (!p) return ctx.answerCbQuery("Not found");
    try {
      const r = await recordApproval(p.id, String(ctx.from?.id ?? ""), "APPROVE");
      await ctx.answerCbQuery(`Approval recorded: ${r.approvalCount}/${p.requiredApprovals}`);
      if (r.status === "APPROVED") {
        await ctx.reply(`⏳ Approval met — executing via KeeperHub...`);
        const out = await executeProposal(p.id);
        const link = out.txHash ? getExplorerTxUrl(p.chain, out.txHash) : "";
        await ctx.replyWithHTML(`✅ <b>EXECUTED</b>\nTX: <code>${escHtml(out.txHash ?? "n/a")}</code>\n${link ? `<a href="${link}">View on explorer</a>` : ""}`);
      } else {
        await ctx.reply(`Approval recorded: ${r.approvalCount}/${p.requiredApprovals}`);
      }
    } catch (e) {
      await ctx.answerCbQuery(e instanceof Error ? e.message : "Failed", { show_alert: true });
    }
  });

  bot.action(/^reject:(.+)$/, async (ctx) => {
    const shortId = ctx.match[1];
    const p = await db().paymentProposal.findUnique({ where: { shortId } });
    if (!p) return ctx.answerCbQuery("Not found");
    try {
      await recordApproval(p.id, String(ctx.from?.id ?? ""), "REJECT");
      await ctx.answerCbQuery("Rejected");
      await ctx.reply(`❌ ${shortId} rejected.`);
    } catch (e) {
      await ctx.answerCbQuery(e instanceof Error ? e.message : "Failed", { show_alert: true });
    }
  });

  bot.action(/^view:(.+)$/, async (ctx) => {
    const shortId = ctx.match[1];
    const p = await db().paymentProposal.findUnique({ where: { shortId } });
    await ctx.answerCbQuery(p ? p.recipient : "Not found", { show_alert: true });
  });

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    if (!/pay|send|transfer/i.test(text)) return;
    await handlePaymentRequest(ctx, text, {
      chatId: String(ctx.chat.id),
      messageId: ctx.message.message_id,
      userId: String(ctx.from?.id ?? "unknown"),
      username: ctx.from?.username,
    });
  });

  return bot;
}
