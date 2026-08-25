import { describe, expect, it } from "vitest";
import { buildPaymentBlueprint } from "./payment-blueprint";

describe("buildPaymentBlueprint", () => {
  it("aceita preços Stripe declarados e limita os modos", () => {
    const result = buildPaymentBlueprint({
      kind: "app", name: "Loja", description: "",
      code: '// AD_BACKEND: {"collections":[],"payments":{"provider":"stripe","prices":{"produto":{"priceId":"price_ABC123"},"pro":{"priceId":"price_PRO456","mode":"subscription"}}}}\nexport default function App(){}',
    });
    expect(result.warnings).toEqual([]);
    expect(result.payments?.prices).toEqual([
      { key: "produto", priceId: "price_ABC123", mode: "payment" },
      { key: "pro", priceId: "price_PRO456", mode: "subscription" },
    ]);
  });

  it("rejeita ids e provedores arbitrários", () => {
    const result = buildPaymentBlueprint({
      kind: "app", name: "Loja", description: "",
      code: '// AD_BACKEND: {"collections":[],"payments":{"provider":"outro","prices":{"x":{"priceId":"prod_123"}}}}',
    });
    expect(result.payments).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });
});
