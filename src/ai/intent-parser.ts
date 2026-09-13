import { z } from "zod";
import { DEFAULT_CHAIN } from "../config/env.js";

export const paymentIntentSchema = z.object({
  action: z.literal("TRANSFER"),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string"),
  token: z.string().min(1),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "recipient must be a 0x EVM address"),
  network: z.string().default(DEFAULT_CHAIN),
  purpose: z.string().max(280).nullish(),
});

export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/** Deterministic regex parser — never guesses missing fields. */
export function parsePaymentText(text: string): { intent?: PaymentIntent; missing?: string[] } {
  const addrMatch = text.match(/0x[a-fA-F0-9]{40}/);
  // amount + token: "0.50 USDC", "pay 2 usdc", "send half"? only numeric supported deterministically
  const amtMatch = text.match(/(\d+(?:\.\d+)?)\s*(USDC|usdc|Usdc)/);
  const missing: string[] = [];
  if (!amtMatch) missing.push("amount");
  if (!addrMatch) missing.push("recipient address");
  if (missing.length) return { missing };
  const raw = {
    action: "TRANSFER" as const,
    amount: amtMatch![1],
    token: "USDC",
    recipient: addrMatch![0],
    network: DEFAULT_CHAIN,
    purpose: null,
  };
  const parsed = paymentIntentSchema.safeParse(raw);
  if (!parsed.success) return { missing: ["amount", "recipient address"] };
  return { intent: parsed.data };
}

/** Optional LLM extraction via generic OpenAI-compatible chat endpoint. */
export async function parseWithLLM(text: string, apiKey: string, model: string): Promise<PaymentIntent | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Extract a payment intent as JSON: {"action":"TRANSFER","amount":"0.5","token":"USDC","recipient":"0x...","network":"base-sepolia","purpose":null}. Never invent recipient or amount; if missing, return {"error":"missing"}.',
          },
          { role: "user", content: text },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = j.choices?.[0]?.message?.content;
    if (!content) return null;
    const obj = JSON.parse(content) as Record<string, unknown>;
    if ((obj as { error?: string }).error) return null;
    const parsed = paymentIntentSchema.safeParse(obj);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
