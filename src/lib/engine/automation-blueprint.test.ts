import { describe, expect, it } from "vitest";
import { automationWindow, buildAutomationBlueprint } from "./automation-blueprint";

describe("blueprint de automações", () => {
  it("extrai lembrete de e-mail declarado pelo app", () => {
    const app = {
      kind: "app" as const, name: "Agenda", description: "", entry: "App.jsx",
      files: [{ path: "App.jsx", content: '// AD_BACKEND: {"collections":[],"automations":[{"name":"lembrete-24h","collection":"agendamentos","dueField":"inicio","leadMinutes":1440,"channel":"email","recipientField":"email","subject":"Sua consulta é amanhã","message":"Lembrete da sua consulta."}]}\nexport default function App(){}' }],
    };
    expect(buildAutomationBlueprint(app).automations[0]).toMatchObject({ name: "lembrete-24h", leadMinutes: 1440 });
  });

  it("ignora canal ou campo inseguro", () => {
    const app = { kind: "app" as const, name: "X", description: "", code: '// AD_BACKEND: {"automations":[{"name":"x","collection":"agenda","dueField":"../data","leadMinutes":1,"channel":"webhook","recipientField":"email","subject":"x","message":"x"}]}\nexport default function App(){}' };
    const result = buildAutomationBlueprint(app);
    expect(result.automations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("calcula a janela futura de execução", () => {
    expect(automationWindow(new Date("2026-01-01T10:00:00.000Z"), 60)).toEqual({
      start: "2026-01-01T11:00:00.000Z",
      end: "2026-01-01T11:05:00.000Z",
    });
  });
});
