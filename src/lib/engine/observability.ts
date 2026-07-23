export type FailureCode =
  | "credits"
  | "authentication"
  | "timeout"
  | "invalid_format"
  | "quality"
  | "rate_limit"
  | "provider"
  | "internal";

const SECRET_PATTERNS = [
  /\bsk-[a-z0-9_-]{12,}\b/gi,
  /\bsk-or-[a-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[a-z0-9._-]+\b/gi,
];

export function safeOperationalMessage(value: unknown, max = 800): string {
  let message = value instanceof Error ? value.message : String(value || "");
  for (const pattern of SECRET_PATTERNS) message = message.replace(pattern, "[credencial removida]");
  return message.replace(/\s+/g, " ").trim().slice(0, max);
}

export function classifyGenerationFailure(value: unknown): FailureCode {
  const message = safeOperationalMessage(value).toLowerCase();
  if (/402|cr[eé]dito|saldo|afford/.test(message)) return "credits";
  if (/401|403|api key|chave inv[aá]lida|unauthoriz|forbidden/.test(message)) return "authentication";
  if (/429|rate.?limit|muitas gera[çc][oõ]es/.test(message)) return "rate_limit";
  if (/timeout|tempo limite|timed out|abort/.test(message)) return "timeout";
  if (/interpretada como c[oó]digo|json ops|formato|parse/.test(message)) return "invalid_format";
  if (/qualidade|auditoria|preview|validation/.test(message)) return "quality";
  if (/openrouter|anthropic|claude|modelo|provider|http 5\d\d/.test(message)) return "provider";
  return "internal";
}

export interface GenerationMetric {
  status: string;
  cost_usd?: number | string | null;
  duration_ms?: number | null;
  error_code?: string | null;
}

export function summarizeGenerationMetrics(rows: GenerationMetric[]) {
  const durations = rows
    .map((row) => Number(row.duration_ms))
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((a, b) => a - b);
  const completed = rows.filter((row) => row.status === "completed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const pending = rows.filter((row) => row.status === "pending").length;
  const p95Index = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : -1;
  const failures: Record<string, number> = {};
  for (const row of rows) {
    if (row.status !== "failed") continue;
    const code = row.error_code || "unknown";
    failures[code] = (failures[code] || 0) + 1;
  }
  return {
    total: rows.length,
    completed,
    failed,
    pending,
    successRate: completed + failed ? Math.round((completed / (completed + failed)) * 1000) / 10 : 100,
    cost: Math.round(rows.reduce((sum, row) => sum + Math.max(0, Number(row.cost_usd) || 0), 0) * 10000) / 10000,
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : null,
    p95DurationMs: p95Index >= 0 ? durations[p95Index] : null,
    failures,
  };
}
