import { describe, expect, it } from "vitest";
import { recoveryLabel, summarizeVersion, versionDelta } from "./version-history";

describe("histórico de versões", () => {
  it("resume aplicativos multi-arquivo", () => {
    const summary = summarizeVersion({
      kind: "app",
      name: "Teste",
      description: "",
      entry: "App.jsx",
      files: [
        { path: "App.jsx", content: "export default function App(){return <Home/>}" },
        { path: "Home.jsx", content: "export default function Home(){return <main/>}" },
      ],
    });

    expect(summary).toMatchObject({ kind: "app", files: 2, label: "Aplicativo · 2 arquivos" });
    expect(summary.characters).toBeGreaterThan(50);
  });

  it("mostra o delta estrutural entre versões", () => {
    const current = {
      kind: "app",
      name: "Teste",
      description: "",
      entry: "App.jsx",
      files: [{ path: "App.jsx", content: "export default 1" }],
    };
    const target = {
      ...current,
      files: [
        ...current.files,
        { path: "Card.jsx", content: "export default 2" },
      ],
    };

    expect(versionDelta(current, target)).toContain("+1 arquivo(s)");
  });

  it("gera rótulo de recuperação curto e identificável", () => {
    expect(recoveryLabel("Cliente aprovou o hero")).toBe(
      "Recuperação automática · antes de restaurar Cliente aprovou o hero"
    );
    expect(recoveryLabel(null)).toContain("versão anterior");
    expect(recoveryLabel("x".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});
