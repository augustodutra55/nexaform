import { describe, expect, it } from "vitest";
import { buildInboundBlueprint } from "./inbound-blueprint";

describe("buildInboundBlueprint", () => {
  it("extrai endpoint seguro para eventos externos", () => {
    const app = {
      kind: "app" as const,
      name: "Clínica",
      description: "",
      code: '// AD_BACKEND: {"collections":[],"inbound":[{"name":"email-clinica","collection":"emails_processados"}]}\nexport default function App(){}',
    };
    expect(buildInboundBlueprint(app).inbound).toEqual([
      { name: "email-clinica", collection: "emails_processados" },
    ]);
  });

  it("ignora nomes e coleções inseguros", () => {
    const app = {
      kind: "app" as const,
      name: "X",
      description: "",
      code: '// AD_BACKEND: {"collections":[],"inbound":[{"name":"../admin","collection":"emails/processados"}]}',
    };
    const result = buildInboundBlueprint(app);
    expect(result.inbound).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
