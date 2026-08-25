export type CommercialIntegrationId = "stripe" | "resend" | "automation";

export interface CommercialIntegrationStatus {
  id: CommercialIntegrationId;
  configured: boolean;
  label: string;
  detail: string;
}

export interface StripeCheckoutInput {
  projectId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;

export function integrationStatuses(env: NodeJS.ProcessEnv = process.env): CommercialIntegrationStatus[] {
  return [
    {
      id: "stripe",
      configured: !!env.STRIPE_SECRET_KEY?.trim(),
      label: "Stripe",
      detail: "Checkout e pagamentos com segredo mantido somente no servidor.",
    },
    {
      id: "resend",
      configured: !!env.RESEND_API_KEY?.trim(),
      label: "Resend",
      detail: "Envio de e-mails transacionais e formulários.",
    },
    {
      id: "automation",
      configured: !!env.AUTOMATION_WEBHOOK_ALLOWLIST?.trim(),
      label: "Automação",
      detail: "Webhooks server-side para n8n, Make ou endpoint autorizado.",
    },
  ];
}

export function normalizeStripeCheckoutInput(input: StripeCheckoutInput): StripeCheckoutInput {
  if (!input.projectId) throw new Error("projectId é obrigatório.");
  if (!PRICE_ID_RE.test(input.priceId || "")) throw new Error("priceId inválido.");
  const successUrl = safeHttpsUrl(input.successUrl, "successUrl");
  const cancelUrl = safeHttpsUrl(input.cancelUrl, "cancelUrl");
  const customerEmail = input.customerEmail?.trim();
  if (customerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail)) {
    throw new Error("E-mail do cliente inválido.");
  }
  return { ...input, successUrl, cancelUrl, customerEmail: customerEmail || undefined };
}

function safeHttpsUrl(raw: string, field: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${field} inválida.`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${field} deve usar HTTPS.`);
  return url.toString();
}

export function allowedAutomationTargets(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.AUTOMATION_WEBHOOK_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => safeHttpsUrl(item, "Webhook"));
}

export function assertAllowedAutomationTarget(target: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = safeHttpsUrl(target, "Webhook");
  const allowed = new Set(allowedAutomationTargets(env));
  if (!allowed.has(normalized)) throw new Error("Webhook não autorizado.");
  return normalized;
}

export async function createStripeCheckoutSession(input: StripeCheckoutInput, secret = process.env.STRIPE_SECRET_KEY): Promise<{ id: string; url: string }> {
  if (!secret?.trim()) throw new Error("Stripe não configurado.");
  const normalized = normalizeStripeCheckoutInput(input);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", normalized.successUrl);
  body.set("cancel_url", normalized.cancelUrl);
  body.set("line_items[0][price]", normalized.priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[project_id]", normalized.projectId);
  if (normalized.customerEmail) body.set("customer_email", normalized.customerEmail);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.id !== "string" || typeof payload?.url !== "string") {
    throw new Error(payload?.error?.message || `Stripe respondeu HTTP ${response.status}.`);
  }
  return { id: payload.id, url: payload.url };
}

export async function dispatchAutomationWebhook(target: string, payload: unknown, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const url = assertAllowedAutomationTarget(target, env);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Webhook respondeu HTTP ${response.status}.`);
}

export async function sendAutomationEmail(input: {
  to: string;
  subject: string;
  message: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim() || "AD Studio <onboarding@resend.dev>";
  if (!key) throw new Error("Resend não configurado.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to)) throw new Error("Destinatário inválido.");
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject.slice(0, 160),
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6">${escape(input.message).replace(/\n/g, "<br>")}</div>`,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Resend respondeu HTTP ${response.status}.`);
}
