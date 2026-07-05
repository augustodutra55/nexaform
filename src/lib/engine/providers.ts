/**
 * Camada de provedores plugáveis (server-only).
 *
 * Ordem de resolução:
 *   1. Chave trazida pelo usuário (settings) — Claude ou OpenRouter
 *   2. ANTHROPIC_API_KEY do ambiente
 *   3. OPENROUTER_API_KEY do ambiente
 *   4. Motor local (sempre disponível — modo demo)
 *
 * Qualquer falha de rede/parse cai automaticamente para o próximo nível.
 */
import { generateLocal } from "./local";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { AppSchema, GenerationResult, isValidSchema } from "./types";
import { CostMode, pickTier, modelFor, estimateCost } from "./models";

interface GenerateArgs {
  message: string;
  schema: AppSchema | null;
  userKey?: string | null;
  userProvider?: "claude" | "openrouter" | "local" | null;
  costMode?: CostMode;
}

function parseLLMResult(
  text: string,
  provider: "claude" | "openrouter",
  cost: number,
  model: string
): GenerationResult | null {
  try {
    const raw = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(raw);
    if (!isValidSchema(parsed.schema)) return null;
    return {
      reply: String(parsed.reply ?? "Pronto! Veja o preview."),
      plan: Array.isArray(parsed.plan) ? parsed.plan.map(String) : [],
      schema: parsed.schema,
      provider,
      cost,
      model,
    };
  } catch {
    return null;
  }
}

async function callClaude(apiKey: string, args: GenerateArgs, model: string): Promise<GenerationResult | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(args.message, args.schema) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    const cost = estimateCost(model, data?.usage?.input_tokens ?? 0, data?.usage?.output_tokens ?? 0);
    return text ? parseLLMResult(text, "claude", cost, model) : null;
  } catch {
    return null;
  }
}

async function callOpenRouter(apiKey: string, args: GenerateArgs, model: string): Promise<GenerationResult | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        usage: { include: true },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(args.message, args.schema) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    const cost =
      typeof data?.usage?.cost === "number"
        ? data.usage.cost
        : estimateCost(model, data?.usage?.prompt_tokens ?? 0, data?.usage?.completion_tokens ?? 0);
    return text ? parseLLMResult(text, "openrouter", cost, model) : null;
  } catch {
    return null;
  }
}

export async function generateWithProviders(args: GenerateArgs): Promise<GenerationResult> {
  const tier = pickTier(args.costMode ?? "auto", { isApp: false, isRefinement: !!args.schema, message: args.message });

  // 1) chave do usuário
  if (args.userKey && args.userProvider === "claude") {
    const r = await callClaude(args.userKey, args, modelFor(tier, "claude"));
    if (r) return r;
  }
  if (args.userKey && args.userProvider === "openrouter") {
    const r = await callOpenRouter(args.userKey, args, modelFor(tier, "openrouter"));
    if (r) return r;
    if (tier === "economy") {
      const r2 = await callOpenRouter(args.userKey, args, modelFor("premium", "openrouter"));
      if (r2) return r2;
    }
  }
  // 2) ambiente — Anthropic
  if (process.env.ANTHROPIC_API_KEY && args.userProvider !== "local") {
    const r = await callClaude(process.env.ANTHROPIC_API_KEY, args, modelFor(tier, "claude"));
    if (r) return r;
  }
  // 3) ambiente — OpenRouter
  if (process.env.OPENROUTER_API_KEY && args.userProvider !== "local") {
    const r = await callOpenRouter(process.env.OPENROUTER_API_KEY, args, modelFor(tier, "openrouter"));
    if (r) return r;
  }
  // 4) motor local — nunca falha (modo demo)
  return generateLocal(args.message, args.schema);
}

/* ── Rate limit simples por chave (memória do processo) ─────── */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string): boolean {
  const limit = Number(process.env.GENERATION_RATE_LIMIT ?? 20);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
