import { describe, expect, it } from "vitest";
import {
  buildVersionComparison,
  checkpointLabel,
  comparisonHeadline,
  recoveryLabel,
  summarizeVersion,
  versionDelta,
} from "./version-history";

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

describe("checkpointLabel", () => {
  it("normaliza espaços e limita o tamanho", () => {
    expect(checkpointLabel("  Aprovado   pelo cliente  ")).toBe("Aprovado pelo cliente");
    expect(checkpointLabel("")).toBe("Checkpoint");
    expect(checkpointLabel(null)).toBe("Checkpoint");
    expect(checkpointLabel("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("buildVersionComparison", () => {
  const base = {
    kind: "app" as const,
    name: "T",
    description: "",
    entry: "App.jsx",
    files: [
      { path: "App.jsx", content: "linha1\nlinha2\nlinha3" },
      { path: "components/Header.jsx", content: "export const Header = () => null" },
    ],
  };
  const next = {
    ...base,
    files: [
      { path: "App.jsx", content: "linha1\nlinha2 alterada\nlinha3" }, // changed
      { path: "components/Footer.jsx", content: "export const Footer = () => null" }, // added
      // Header.jsx removido
    ],
  };

  it("classifica arquivos como adicionado, removido, alterado", () => {
    const cmp = buildVersionComparison(base, next);
    const byPath = Object.fromEntries(cmp.files.map((f) => [f.path, f.status]));
    expect(byPath["components/Footer.jsx"]).toBe("added");
    expect(byPath["components/Header.jsx"]).toBe("removed");
    expect(byPath["App.jsx"]).toBe("changed");
    expect(cmp.filesAdded).toBe(1);
    expect(cmp.filesRemoved).toBe(1);
    expect(cmp.filesChanged).toBe(1);
  });

  it("conta linhas adicionadas e removidas no arquivo alterado", () => {
    const cmp = buildVersionComparison(base, next);
    const app = cmp.files.find((f) => f.path === "App.jsx")!;
    expect(app.added).toBe(1);
    expect(app.removed).toBe(1);
  });

  it("coloca as mudanças antes dos arquivos iguais", () => {
    const same = buildVersionComparison(base, base);
    expect(same.files.every((f) => f.status === "same")).toBe(true);
    expect(same.filesAdded + same.filesRemoved + same.filesChanged).toBe(0);
  });

  it("resume a comparação em uma frase", () => {
    expect(comparisonHeadline(buildVersionComparison(base, next))).toContain("adicionado");
    expect(comparisonHeadline(buildVersionComparison(base, base))).toBe(
      "Nenhuma diferença de arquivos"
    );
  });
});
