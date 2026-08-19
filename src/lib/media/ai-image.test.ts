import { describe, expect, it } from "vitest";
import { resolveAdimgInApp } from "./ai-image";

describe("resolveAdimgInApp — resolve marcadores ADIMG (fila durável)", () => {
  it("sem chave, troca ADIMG por um placeholder que carrega (nunca deixa quebrado)", async () => {
    const app = {
      files: [
        { path: "components/NossasCores.jsx", content: `<img src="ADIMG: light skin hand" alt="clara" />` },
        { path: "components/Hero.jsx", content: `<img src="ADIMG: dark skin hand" alt="escura" />` },
      ],
    };
    const generated = await resolveAdimgInApp(app, { apiKey: null, supabase: null, projectId: "p1" });
    expect(generated).toBe(0); // nada gerado (sem chave)
    // nenhum marcador ADIMG cru sobra
    expect(app.files.every((f) => !/ADIMG:/.test(f.content))).toBe(true);
    // vira um data-URI que sempre carrega
    expect(app.files[0].content).toContain("data:image/svg+xml");
    expect(app.files[1].content).toContain("data:image/svg+xml");
  });

  it("não altera arquivos sem marcador ADIMG", async () => {
    const app = { files: [{ path: "App.jsx", content: "export default () => <main>ok</main>;" }] };
    const before = app.files[0].content;
    const generated = await resolveAdimgInApp(app, { apiKey: null, supabase: null, projectId: "p1" });
    expect(generated).toBe(0);
    expect(app.files[0].content).toBe(before);
  });

  it("resolve também no formato de código único (app.code)", async () => {
    const app = { code: `<img src="ADIMG: manicure" />` };
    await resolveAdimgInApp(app, { apiKey: null, supabase: null, projectId: "p1" });
    expect(app.code).not.toContain("ADIMG:");
    expect(app.code).toContain("data:image/svg+xml");
  });
});
