import { describe, expect, it } from "vitest";
import { detectProjectRegressions, explicitlyRemoves } from "./project-regression";
import { isRunnableReport } from "./project-validator";
import type { AppCode } from "./app-types";
import { validateDataRecord, type DataFieldRule } from "./data-contract";

function app(content: string, files: AppCode["files"] = []): AppCode {
  return { kind: "app", name: "Teste", description: "", entry: "App.jsx", files: [{ path: "App.jsx", content }, ...files] };
}

const manifest = {
  collections: [
    { name: "procedimentos", profile: "catalog" },
    { name: "agendamentos", profile: "form", allowedRoles: ["admin", "equipe"] },
  ],
};
const booking = "export default function App(){ return <form onSubmit={async e=>{e.preventDefault(); await AD.availability('agendamentos',{}); await AD.insert('agendamentos',{});}}><button>Agendar</button></form> }";
const header = (value: unknown) => `// AD_BACKEND: ${JSON.stringify(value)}\n`;

describe("proteção determinística contra regressões", () => {
  it("permite edição visual sem perder o fluxo real", () => {
    const before = app(header(manifest) + booking);
    const after = app(header(manifest) + booking.replace("Agendar", "Confirmar horário"));
    expect(detectProjectRegressions(before, after, "melhore os textos")).toEqual([]);
  });

  it("bloqueia perda de agendamento e disponibilidade antes de salvar", () => {
    const before = app(header(manifest) + booking);
    const after = app(header(manifest) + "export default function App(){ return <button>Agendar</button> }");
    const errors = detectProjectRegressions(before, after, "mude a cor para azul");
    expect(errors.filter((item) => item.code === "regression_runtime")).toHaveLength(2);
    expect(isRunnableReport({ errors })).toBe(false);
  });

  it("não aceita comentário, string ou módulo órfão como prova de retenção", () => {
    const module = { path: "Agenda.jsx", content: booking.replace("App()", "Agenda()") };
    const before = app('import Agenda from "./Agenda"; export default function App(){return <Agenda/>}', [module]);
    const after = app('export default function App(){return <main/>} // AD.insert("agendamentos", {})\nconst fake = "AD.availability(\'agendamentos\',{})";', [module]);
    expect(detectProjectRegressions(before, after, "melhore o layout").map((item) => item.code)).toContain("regression_runtime");
  });

  it("aceita reorganização de módulos e alias do runtime", () => {
    const before = app(booking);
    const after = app('import Agenda from "./screens/Agenda"; export default function App(){return <Agenda/>}', [
      { path: "screens/Agenda.jsx", content: "const api = window.AD;\n" + booking.replace(/AD\./g, "api.") },
    ]);
    expect(detectProjectRegressions(before, after, "organize os arquivos")).toEqual([]);
  });

  it("preserva o manifesto mesmo quando as chamadas ainda existem", () => {
    const errors = detectProjectRegressions(app(header(manifest) + booking), app(booking), "altere o título");
    expect(errors.filter((item) => item.code === "regression_backend")).toHaveLength(2);
  });

  it("preserva campos, unicidade e referências no contrato de dados", () => {
    const before = app(header({ collections: [{ name: "pacientes", profile: "private", fields: { cpf: { type: "string", required: true, unique: true } } }] }) + booking);
    const after = app(header({ collections: [{ name: "pacientes", profile: "private", fields: { cpf: { type: "string" } } }] }) + booking);
    expect(detectProjectRegressions(before, after, "troque a fonte").map((item) => item.code)).toContain("regression_backend");
  });

  it("bloqueia ampliação silenciosa de acesso a pacientes", () => {
    const previous = { collections: [{ name: "pacientes", profile: "authenticated", allowedRoles: ["admin"], authenticatedScope: "own" }] };
    for (const change of [{ profile: "catalog" }, { allowedRoles: [] }, { authenticatedScope: "all" }]) {
      const next = { collections: [{ ...previous.collections[0], ...change }] };
      const errors = detectProjectRegressions(app(header(previous) + booking), app(header(next) + booking), "melhore a versão mobile");
      expect(errors.map((item) => item.code)).toContain("regression_access");
    }
  });

  it.each([
    ["private", "catalog"], ["private", "form"], ["private", "authenticated"],
    ["custom", "catalog"], ["custom", "form"], ["custom", "authenticated"],
    ["catalog", "form"], ["catalog", "authenticated"],
    ["form", "catalog"], ["form", "authenticated"],
    ["authenticated", "catalog"], ["authenticated", "form"],
  ])("bloqueia novo acesso ao trocar %s por %s", (oldProfile, newProfile) => {
    const contract = (profile: string) => app(header({ collections: [{ name: "pacientes", profile }] }) + booking);
    expect(detectProjectRegressions(contract(oldProfile), contract(newProfile), "melhore o layout").map((item) => item.code)).toContain("regression_access");
  });

  it("permite restringir acesso e papéis sem tratar a mudança como exposição", () => {
    const contract = (profile: string, allowedRoles: string[] = []) => app(header({ collections: [{ name: "pacientes", profile, allowedRoles }] }) + booking);
    expect(detectProjectRegressions(contract("authenticated"), contract("private"), "restrinja acesso")).toEqual([]);
    expect(detectProjectRegressions(contract("authenticated", ["admin", "equipe"]), contract("authenticated", ["admin"]), "restrinja acesso")).toEqual([]);
  });

  it("não usa um pedido de remoção para autorizar exposição da coleção restante", () => {
    const contract = (profile: string) => app(header({ collections: [{ name: "pacientes", profile }] }) + booking);
    expect(detectProjectRegressions(contract("private"), contract("form"), "remova a coleção pacientes").map((item) => item.code)).toContain("regression_access");
  });

  const validationChanges: Array<[string, DataFieldRule, DataFieldRule, unknown]> = [
    ["email vira texto livre", { type: "email" }, { type: "string" }, "inválido"],
    ["inteiro aceita fração", { type: "integer" }, { type: "number" }, 1.5],
    ["remove pattern", { type: "string", pattern: "^[0-9]+$" }, { type: "string" }, "ABC"],
    ["troca pattern por qualquer texto", { type: "string", pattern: "^[0-9]+$" }, { type: "string", pattern: ".*" }, "ABC"],
    ["reduz minLength", { type: "string", minLength: 3 }, { type: "string", minLength: 1 }, "a"],
    ["remove minLength", { type: "string", minLength: 3 }, { type: "string" }, "a"],
    ["aumenta maxLength", { type: "string", maxLength: 3 }, { type: "string", maxLength: 9 }, "abcdef"],
    ["remove maxLength", { type: "string", maxLength: 3 }, { type: "string" }, "abcdef"],
    ["reduz min", { type: "number", min: 10 }, { type: "number", min: 0 }, 1],
    ["remove min", { type: "number", min: 10 }, { type: "number" }, 1],
    ["aumenta max", { type: "number", max: 10 }, { type: "number", max: 20 }, 15],
    ["remove max", { type: "number", max: 10 }, { type: "number" }, 15],
    ["remove enum", { type: "string", enum: ["pendente"] }, { type: "string" }, "qualquer"],
    ["amplia enum", { type: "string", enum: ["pendente"] }, { type: "string", enum: ["pendente", "qualquer"] }, "qualquer"],
  ];
  it.each(validationChanges)("rejeita contrato que %s", (_name, oldRule, newRule, malformed) => {
    const contract = (rule: DataFieldRule) => ({ version: 1 as const, allowUnknown: false, fields: { dado: rule } });
    // Demonstrate a record the previous contract rejects and the candidate
    // would accept, rather than merely asserting the comparator's branches.
    expect(validateDataRecord({ dado: malformed }, contract(oldRule)).valid).toBe(false);
    expect(validateDataRecord({ dado: malformed }, contract(newRule)).valid).toBe(true);
    const project = (rule: DataFieldRule) => app(header({ collections: [{ name: "pacientes", profile: "private", fields: { dado: rule } }] }) + booking);
    expect(detectProjectRegressions(project(oldRule), project(newRule), "troque as cores").map((item) => item.code)).toContain("regression_backend");
  });

  it("impede aceitar campos não declarados e trocar referências existentes", () => {
    const collection = { name: "pacientes", profile: "private", allowUnknown: false, fields: { contato: { type: "uuid", reference: { collection: "contatos" } } } };
    const previous = app(header({ collections: [collection] }) + booking);
    for (const change of [{ allowUnknown: true }, { fields: { contato: { type: "uuid", reference: { collection: "laboratorios" } } } }]) {
      const next = app(header({ collections: [{ ...collection, ...change }] }) + booking);
      expect(detectProjectRegressions(previous, next, "melhore o layout").map((item) => item.code)).toContain("regression_backend");
    }
  });

  it("permite validações comprovadamente mais restritas", () => {
    const fields = { contato: { type: "string", minLength: 3, maxLength: 100, enum: ["a@b.com", "c@d.com"] }, valor: { type: "number", min: 0, max: 100 } };
    const previous = app(header({ collections: [{ name: "pacientes", profile: "private", fields }] }) + booking);
    const next = app(header({ collections: [{ name: "pacientes", profile: "private", fields: {
      contato: { ...fields.contato, type: "email", required: true, unique: true, minLength: 4, maxLength: 90, enum: ["a@b.com"] },
      valor: { ...fields.valor, type: "integer", min: 1, max: 90 },
    } }] }) + booking);
    expect(detectProjectRegressions(previous, next, "melhore a validação")).toEqual([]);
  });

  it("preserva automações, ações HTTP, webhooks e preços", () => {
    const integrations = {
      ...manifest,
      automations: [{ name: "lembrete-24h", collection: "agendamentos", dueField: "inicio", leadMinutes: 1440, channel: "email", recipientField: "email", subject: "Consulta", message: "Seu horário" }],
      actions: [{ name: "enviar-whatsapp", target: "https://api.example/messages" }],
      inbound: [{ name: "email-clinica", collection: "agendamentos" }],
      payments: { provider: "stripe", prices: { consulta: { priceId: "price_123", mode: "payment" } } },
    };
    const errors = detectProjectRegressions(app(header(integrations) + booking), app(header(manifest) + booking), "melhore o hero");
    expect(errors.filter((item) => item.code === "regression_integration")).toHaveLength(4);
  });

  it("não aceita perder imagem ou player ao refinar outra parte", () => {
    const before = app('export default function App(){return <><img src="https://cdn.example/foto.jpg" alt="Equipe"/><video src="" controls /></>}');
    const after = app('export default function App(){return <main/>}');
    expect(detectProjectRegressions(before, after, "corrija o formulário").filter((item) => item.code === "regression_media")).toHaveLength(2);
  });

  it("permite substituir mídias e remover um alvo explicitamente pedido", () => {
    const before = app('export default function App(){return <img src="https://cdn.example/antiga.jpg" alt="Equipe"/>}');
    const after = app('export default function App(){return <img src="https://cdn.example/nova.jpg" alt="Equipe"/>}');
    expect(detectProjectRegressions(before, after, "troque a foto")).toEqual([]);
    expect(detectProjectRegressions(before, app('export default function App(){return <main/>}'), "Remova as imagens")).toEqual([]);
  });

  it("aceita imagem de fundo e embed real como substituições de mídia", () => {
    const before = app('export default function App(){return <><img src="https://cdn.example/foto.jpg" alt="Equipe"/><video src="https://cdn.example/video.mp4" controls /></>}');
    const after = app('export default function App(){return <><div style={{backgroundImage:"url(https://cdn.example/nova.jpg)"}}/><iframe src="https://www.youtube.com/embed/realVideoId" title="Vídeo" /></>}');
    expect(detectProjectRegressions(before, after, "modernize a composição")).toEqual([]);
  });
});

describe("autorizações de remoção dirigidas", () => {
  it("não deixa um pedido de FAQ autorizar a perda da agenda", () => {
    expect(explicitlyRemoves("Remova o FAQ e mantenha a agenda", ["agenda"])).toBe(false);
    expect(explicitlyRemoves("Remova apenas o módulo agendamentos", ["agendamentos"])).toBe(true);
  });
  it("respeita proibições de remover", () => {
    expect(explicitlyRemoves("Não remova o login", ["login"])).toBe(false);
    expect(explicitlyRemoves("Nunca remova os vídeos", ["video", "videos"])).toBe(false);
    expect(explicitlyRemoves("Retire o login", ["login"])).toBe(true);
  });
});
