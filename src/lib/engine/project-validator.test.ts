import { describe, expect, it } from "vitest";
import type { AppCode } from "./app-types";
import { buildGenerationPlan } from "./generation-plan";
import { validateAppProject } from "./project-validator";

function appWith(component: string): AppCode {
  return {
    kind: "app",
    name: "Teste",
    description: "Teste",
    entry: "App.jsx",
    files: [
      {
        path: "App.jsx",
        content: `import Screen from "./components/Screen.jsx";\nexport default function App(){ return <Screen />; }`,
      },
      { path: "components/Screen.jsx", content: component },
    ],
  };
}

describe("validateAppProject visual e mídia", () => {
  it("reprova múltiplas cenas 3D", () => {
    const app = appWith(`
      import { Canvas } from "@react-three/fiber";
      export default function Screen(){
        return <><img alt="fallback" className="object-cover" decoding="async" src="ADIMG: car" />
          <Canvas dpr={[1, 1.5]} fallback={<img alt="fallback" src="ADIMG: car" />} />
          <Canvas dpr={[1, 1.5]} fallback={<img alt="fallback" src="ADIMG: car" />} />
        </>;
      }`);
    const report = validateAppProject(app, buildGenerationPlan("experiência 3D imersiva de carros"));

    expect(report.errors.some((entry) => entry.code === "multiple_3d_scenes")).toBe(true);
  });

  it("sinaliza tratamento de imagem e carregamento ausentes", () => {
    const app = appWith(`
      export default function Screen(){
        return <><img src="ADIMG: dental clinic" /><img src="ADIMG: dentist" /></>;
      }`);
    const report = validateAppProject(app, buildGenerationPlan("site de clínica odontológica"));
    const codes = report.warnings.map((entry) => entry.code);

    expect(codes).toContain("image_alt");
    expect(codes).toContain("image_crop");
    expect(codes).toContain("image_lazy_loading");
    expect(codes).toContain("image_async_decode");
  });

  it("exige comportamento de vídeo compatível com mobile", () => {
    const app = appWith(`
      export default function Screen(){
        return <video src="" data-ad-media="video" poster="ADIMG: gym" controls />;
      }`);
    const report = validateAppProject(app, buildGenerationPlan("landing com vídeo para academia"));
    const codes = report.warnings.map((entry) => entry.code);

    expect(report.errors.some((entry) => entry.code === "missing_video_placeholder")).toBe(false);
    expect(codes).toContain("video_inline");
    expect(codes).toContain("video_preload");
  });
});
