import { describe, expect, it } from "vitest";
import type { AppCode } from "./app-types";
import { buildGenerationPlan } from "./generation-plan";
import { validateAppProject, isRunnableReport } from "./project-validator";

describe("isRunnableReport — entregar quando roda, falhar só quando não abre", () => {
  it("app com erro de COMPLETUDE (seção faltando, componente órfão) é entregável", () => {
    expect(isRunnableReport({ errors: [{ code: "missing_required_section", message: "" }] })).toBe(true);
    expect(isRunnableReport({ errors: [{ code: "orphan_component", message: "" }] })).toBe(true);
    expect(isRunnableReport({ errors: [{ code: "missing_commercial_flow", message: "" }] })).toBe(true);
  });

  it("app com erro FATAL (não roda) NÃO é entregável", () => {
    expect(isRunnableReport({ errors: [{ code: "syntax_error", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "missing_import", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "missing_entry", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "auth_dead_end", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "invalid_ad_get", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "unsupported_ad_find", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "unsupported_ad_query", message: "" }] })).toBe(false);
    expect(isRunnableReport({ errors: [{ code: "unsupported_ad_delete", message: "" }] })).toBe(false);
  });

  it("sem erros, é entregável", () => {
    expect(isRunnableReport({ errors: [] })).toBe(true);
  });
});

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

describe("validateAppProject — tamanho não bloqueia", () => {
  it("um componente grande porém válido NÃO é erro: file_too_large vira aviso", () => {
    // Reproduz o caso da agenda (BookingFlow.jsx > 220 linhas, válida e funcional)
    // que antes era descartada só pelo tamanho.
    const bigBody = Array.from({ length: 240 }, (_, i) => `  const passo${i} = ${i};`).join("\n");
    const component = `export default function Screen(){\n${bigBody}\n  return <div className="p-4">Agenda</div>;\n}`;
    const report = validateAppProject(appWith(component), buildGenerationPlan("agenda de agendamento"));

    expect(report.errors.some((entry) => entry.code === "file_too_large")).toBe(false);
    expect(report.warnings.some((entry) => entry.code === "file_too_large")).toBe(true);
  });
});

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

describe("validateAppProject conclusão funcional", () => {
  it("reprova AD.get sem id e orienta listagem pela API correta", () => {
    const report = validateAppProject(
      appWith("export default function Screen(){ React.useEffect(() => { AD.get('pacientes').then(setPacientes); }, []); return <main>Pacientes</main>; }"),
      buildGenerationPlan("programa odontológico com pacientes")
    );

    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "invalid_ad_get",
      path: "components/Screen.jsx",
    }));
    expect(report.valid).toBe(false);
  });

  it("reprova AD.find inventado e orienta filtro pela API suportada", () => {
    const report = validateAppProject(
      appWith("export default function Screen(){ React.useEffect(() => { AD.find('pacientes', { ativo: true }).then(setPacientes); }, []); return <main>Pacientes</main>; }"),
      buildGenerationPlan("programa odontológico com pacientes")
    );

    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_ad_find",
      path: "components/Screen.jsx",
    }));
    expect(report.valid).toBe(false);
  });

  it("reprova AD.query em novas gerações para impedir retorno .data incompatível", () => {
    const report = validateAppProject(
      appWith("export default function Screen(){ React.useEffect(() => { AD.query('pacientes', { userId }).then(result => setPacientes(result.data)); }, []); return <main>Pacientes</main>; }"),
      buildGenerationPlan("programa odontológico com pacientes")
    );

    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_ad_query",
      path: "components/Screen.jsx",
    }));
    expect(report.valid).toBe(false);
  });

  it("reprova AD.delete legado e exige AD.remove em novas gerações", () => {
    const report = validateAppProject(
      appWith("export default function Screen(){ return <button onClick={() => AD.delete('pacientes', id)}>Apagar</button>; }"),
      buildGenerationPlan("programa odontológico com pacientes")
    );

    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_ad_delete",
      path: "components/Screen.jsx",
    }));
    expect(report.valid).toBe(false);
  });

  it("reprova componente React criado mas não alcançável pelo App", () => {
    const app: AppCode = {
      kind: "app",
      name: "Teste",
      description: "Teste",
      entry: "App.jsx",
      files: [
        { path: "App.jsx", content: 'import Screen from "./components/Screen"; export default function App(){ return <Screen />; }' },
        { path: "components/Screen.jsx", content: "export default function Screen(){ return <main>Loja</main>; }" },
        { path: "components/FAQ.jsx", content: "export default function FAQ(){ return <section>FAQ</section>; }" },
      ],
    };

    const report = validateAppProject(app, buildGenerationPlan("crie uma loja"));

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "orphan_component", path: "components/FAQ.jsx" }));
  });

  it("reprova autenticação obrigatória ausente", () => {
    const report = validateAppProject(
      appWith('export default function Screen(){ return <main>Agenda</main>; }'),
      buildGenerationPlan("aplicativo de agenda com cadastro, login e conta do usuário")
    );

    expect(report.errors.some((entry) => entry.code === "missing_auth")).toBe(true);
  });

  it("reprova o caso odontológico: me/signOut sem entrar ou criar conta", () => {
    const candidate = appWith(`
      export default function Screen(){
        React.useEffect(() => { AD.auth.me(); }, []);
        return <main><button onClick={() => AD.auth.signOut()}>Sair</button></main>;
      }
    `);
    candidate.files![0].content = `// AD_BACKEND: {"collections":[{"name":"patients","access":"authenticated"},{"name":"appointments","access":"authenticated"}]}\n${candidate.files![0].content}`;

    const report = validateAppProject(candidate, buildGenerationPlan("programa odontológico com pacientes e agenda"));

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "auth_dead_end" }));
    expect(report.valid).toBe(false);
  });

  it("exige entrar e criar conta quando a especificação pede autenticação", () => {
    const report = validateAppProject(
      appWith('export default function Screen(){ return <button onClick={() => AD.auth.signIn(email, senha)}>Entrar</button>; }'),
      buildGenerationPlan("programa com login e cadastro")
    );

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "missing_auth" }));
  });

  it("reprova jornada comercial obrigatória sem checkout", () => {
    const report = validateAppProject(
      appWith('export default function Screen(){ return <main><h1>Produtos e preços</h1></main>; }'),
      buildGenerationPlan("loja com catálogo, preço e checkout")
    );

    expect(report.errors.some((entry) => entry.code === "missing_commercial_flow")).toBe(true);
  });

  it("reprova JSX inválido antes de devolver o projeto", () => {
    const app = appWith('export default function Screen(){ return <main>Loja</main>; }\n</section>');
    const report = validateAppProject(app, buildGenerationPlan("crie uma loja"));

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "syntax_error", path: "components/Screen.jsx" }));
  });

  it("reprova seção explicitamente pedida que não foi renderizada", () => {
    const report = validateAppProject(
      appWith('export default function Screen(){ return <main><h1>Loja</h1></main>; }'),
      buildGenerationPlan("crie uma loja com benefícios, prova social e FAQ")
    );

    const missing = report.errors.filter((entry) => entry.code === "missing_required_section").map((entry) => entry.message);
    expect(missing).toHaveLength(3);
    expect(missing.join(" ")).toContain("FAQ");
  });

  it("reconhece componente Benefits alcançável como seção de benefícios", () => {
    const app = appWith(
      "export default function Benefits(){ return <section><h2>Qualidade certificada</h2></section>; }"
    );
    app.files![0].content =
      "import Benefits from './components/Screen'; export default function App(){ return <Benefits />; }";

    const report = validateAppProject(app, buildGenerationPlan("crie uma loja com benefícios"));

    expect(report.errors).not.toContainEqual(expect.objectContaining({ code: "missing_required_section" }));
  });
});
