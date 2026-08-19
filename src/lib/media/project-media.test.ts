import { describe, expect, it } from "vitest";
import { findProjectMedia, replaceProjectMedia } from "./project-media";

const file = (path: string, content: string) => ({ path, content });

describe("findProjectMedia — detecta todas as imagens do site (não só a principal)", () => {
  it("acha <img> com ADIMG e com URL", () => {
    const items = findProjectMedia(
      [
        file(
          "components/Hero.jsx",
          `export default () => (<section><h1>Esmalteria</h1><img src="ADIMG: modern nail salon" alt="Salão" /></section>)`
        ),
        file(
          "components/Servicos.jsx",
          `export default () => (<img src="https://cdn.exemplo.com/servico.jpg" alt="Manicure" />)`
        ),
      ],
      "Esmalteria"
    );
    expect(items.length).toBe(2);
    expect(items.map((i) => i.source)).toContain("ADIMG: modern nail salon");
    expect(items.map((i) => i.source)).toContain("https://cdn.exemplo.com/servico.jpg");
  });

  it("acha imagem de FUNDO em style backgroundImage e em Tailwind bg-[url(...)]", () => {
    const items = findProjectMedia(
      [
        file(
          "components/Hero.jsx",
          `export default () => (<div style={{ backgroundImage: "url('ADIMG: elegant salon interior')" }}>Hero</div>)`
        ),
        file(
          "components/CTA.jsx",
          `export default () => (<div className="bg-[url('https://cdn.exemplo.com/cta.jpg')]">CTA</div>)`
        ),
      ],
      "Esmalteria"
    );
    const sources = items.map((i) => i.source);
    expect(sources).toContain("ADIMG: elegant salon interior");
    expect(sources).toContain("https://cdn.exemplo.com/cta.jpg");
  });

  it("detecta ILUSTRAÇÃO em SVG (a mão) como bloco trocável", () => {
    const hand = `<svg viewBox="0 0 200 200" className="w-64 h-64">
      <defs><linearGradient id="nailGradient" x1="0%"><stop offset="0%"/></linearGradient></defs>
      <path d="M10 10 L20 20" fill="url(#nailGradient)"/>
      <path d="M30 30 L40 40"/><path d="M50 50 L60 60"/>
    </svg>`;
    const items = findProjectMedia(
      [file("components/Hero.jsx", `export default () => (<div><h2>Mão feminina com unhas bem cuidadas</h2>${hand}</div>)`)],
      "Esmalteria"
    );
    const svg = items.find((i) => i.isSvg);
    expect(svg).toBeTruthy();
    expect(svg!.kind).toBe("image");
    expect(svg!.context).toMatch(/[Mm]ão/);
  });

  it("NÃO trata ícone pequeno de SVG como ilustração", () => {
    const icon = `<svg viewBox="0 0 24 24"><path d="M5 5h2"/></svg>`;
    const items = findProjectMedia(
      [file("components/Icone.jsx", `export default () => (<button>${icon}</button>)`)],
      "Esmalteria"
    );
    expect(items.some((i) => i.isSvg)).toBe(false);
  });

  it("troca o bloco SVG por uma <img> com a foto gerada", () => {
    const hand = `<svg viewBox="0 0 200 200" className="w-64 h-64 mx-auto"><linearGradient id="g"/><path d="M1 1"/><path d="M2 2"/><path d="M3 3"/></svg>`;
    const files = [file("components/Hero.jsx", `export default () => (<div>${hand}</div>)`)];
    const [item] = findProjectMedia(files, "Esmalteria").filter((i) => i.isSvg);
    const next = replaceProjectMedia(files, item, "https://cdn.exemplo.com/mao-real.jpg");
    expect(next).not.toBeNull();
    expect(next![0].content).toContain('<img src="https://cdn.exemplo.com/mao-real.jpg"');
    expect(next![0].content).toContain("w-64 h-64 mx-auto"); // herda o className do svg
    expect(next![0].content).not.toContain("<svg");
  });

  it("substitui a imagem de fundo pelo novo URL", () => {
    const files = [
      file(
        "components/Hero.jsx",
        `export default () => (<div style={{ backgroundImage: "url('ADIMG: salon')" }}>Hero</div>)`
      ),
    ];
    const [item] = findProjectMedia(files, "Esmalteria");
    const next = replaceProjectMedia(files, item, "https://cdn.exemplo.com/nova.jpg");
    expect(next).not.toBeNull();
    expect(next![0].content).toContain("https://cdn.exemplo.com/nova.jpg");
    expect(next![0].content).not.toContain("ADIMG: salon");
  });
});
