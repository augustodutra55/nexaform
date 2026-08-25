import { describe, expect, it } from "vitest";
import {
  allowedAutomationTargets,
  assertAllowedAutomationTarget,
  integrationStatuses,
  normalizeStripeCheckoutInput,
  sendAutomationEmail,
} from "./commercial";

describe("commercial integrations", () => {
  it("expõe somente status de configuração", () => {
    const env = {
      STRIPE_SECRET_KEY: "sk_test_secret",
      RESEND_API_KEY: "re_secret",
      AUTOMATION_WEBHOOK_ALLOWLIST: "https://hooks.example.com/ad",
    } as unknown as NodeJS.ProcessEnv;
    const statuses = integrationStatuses(env);
    expect(statuses.map((item) => [item.id, item.configured])).toEqual([
      ["stripe", true],
      ["resend", true],
      ["automation", true],
    ]);
    expect(JSON.stringify(statuses)).not.toContain("sk_test_secret");
  });

  it("valida checkout sem aceitar URLs inseguras", () => {
    expect(normalizeStripeCheckoutInput({
      projectId: "project-1",
      priceId: "price_123ABC",
      successUrl: "https://app.example.com/sucesso",
      cancelUrl: "https://app.example.com/cancelado",
      customerEmail: "cliente@example.com",
    }).priceId).toBe("price_123ABC");
    expect(() => normalizeStripeCheckoutInput({
      projectId: "project-1",
      priceId: "prod_123",
      successUrl: "https://app.example.com/sucesso",
      cancelUrl: "https://app.example.com/cancelado",
    })).toThrow(/priceId/);
    expect(() => normalizeStripeCheckoutInput({
      projectId: "project-1",
      priceId: "price_123",
      successUrl: "http://app.example.com/sucesso",
      cancelUrl: "https://app.example.com/cancelado",
    })).toThrow(/HTTPS/);
  });

  it("preserva o placeholder oficial e o modo de assinatura", () => {
    const normalized = normalizeStripeCheckoutInput({
      projectId: "project-1",
      priceId: "price_PRO123",
      mode: "subscription",
      successUrl: "https://app.example.com/sucesso?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.com/cancelado",
    });
    expect(normalized.mode).toBe("subscription");
    expect(normalized.successUrl).toContain("{CHECKOUT_SESSION_ID}");
  });

  it("limita webhooks a uma allowlist HTTPS exata", () => {
    const env = {
      AUTOMATION_WEBHOOK_ALLOWLIST: "https://hooks.example.com/ad, https://n8n.example.com/webhook/abc",
    } as unknown as NodeJS.ProcessEnv;
    expect(allowedAutomationTargets(env)).toHaveLength(2);
    expect(assertAllowedAutomationTarget("https://hooks.example.com/ad", env)).toBe("https://hooks.example.com/ad");
    expect(() => assertAllowedAutomationTarget("https://evil.example.com/hook", env)).toThrow(/não autorizado/);
  });

  it("não tenta enviar automação sem Resend configurado", async () => {
    await expect(sendAutomationEmail({
      to: "cliente@example.com",
      subject: "Lembrete",
      message: "Sua consulta é amanhã.",
    }, {} as NodeJS.ProcessEnv)).rejects.toThrow("Resend não configurado");
  });
});
