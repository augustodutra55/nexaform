/**
 * Provedores de geração de CÓDIGO (server-only) — o núcleo do clone do Lovable.
 *
 * Ordem: chave do usuário → ANTHROPIC_API_KEY → OPENROUTER_API_KEY → template.
 * Com roteamento de modelo (econômico/premium) e captura de custo real, para
 * o Studio operar barato.
 */
import { AppFile, AppGenerationResult, codeStats, projectStats } from "./app-types";
import { CODE_SYSTEM_PROMPT, buildCodeUserPrompt } from "./code-prompts";
import { matchTemplate } from "./code-templates";
import { CostMode, pickTier, modelFor, estimateCost } from "./models";

interface Args {
  message: string;
  /** Projeto atual: multi-arquivo (preferido) ou código single-file legado. */
  currentFiles?: AppFile[] | null;
  currentCode?: string | null;
  name: string;
  userKey?: string | null;
  userProvider?: "claude" | "openrouter" | "local" | null;
  costMode?: CostMode;
  /** Modo real forçado: nunca cai em template/demo — falha claro se não houver IA. */
  forceReal?: boolean;
  /** Permite template enlatado / demo (só quando o usuário aceitar). */
  allowTemplate?: boolean;
}

/** Normaliza e valida os arquivos devolvidos pelo modelo. */
function normalizeFiles(rawFiles: any): AppFile[] | null {
  if (!Array.isArray(rawFiles)) return null;
  const files: AppFile[] = [];
  for (const f of rawFiles) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
    const path = f.path.replace(/^\.?\//, "").trim();
    if (!path || !f.content.trim()) continue;
    files.push({ path, content: f.content });
  }
  return files.length ? files : null;
}

function parse(
  text: string,
  provider: "claude" | "openrouter",
  cost: number,
  model: string
): AppGenerationResult | null {
  try {
    const raw = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    const j = JSON.parse(raw);

    // Caminho preferido: projeto multi-arquivo com imports reais.
    const files = normalizeFiles(j.files);
    if (files) {
      // Descobre o entry: campo entry válido, ou App.jsx, ou o 1º arquivo.
      let entry: string =
        typeof j.entry === "string" ? j.entry.replace(/^\.?\//, "").trim() : "";
      if (!files.some((f) => f.path === entry)) {
        entry =
          files.find((f) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(f.path))?.path ?? files[0].path;
      }
      const app = { kind: "app" as const, name: j.name || "App", description: "", files, entry, provider };
      return {
        provider,
        engineMode: "real",
        stats: projectStats(app),
        reply: String(j.reply ?? "Pronto! Projeto atualizado."),
        plan: Array.isArray(j.plan) ? j.plan.map(String) : [],
        app,
        cost,
        model,
      };
    }

    // Compatibilidade: single-file legado.
    if (typeof j.code === "string" && j.code.includes("function App")) {
      return {
        provider,
        engineMode: "real",
        stats: codeStats(j.code),
        reply: String(j.reply ?? "Pronto! App atualizado."),
        plan: Array.isArray(j.plan) ? j.plan.map(String) : [],
        app: { kind: "app", name: j.name || "App", description: "", code: j.code, provider },
        cost,
        model,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Estado atual do projeto para o prompt: multi-arquivo (preferido) ou single-file. */
function currentOf(a: Args): AppFile[] | string | null {
  if (a.currentFiles && a.currentFiles.length) return a.currentFiles;
  return a.currentCode ?? null;
}

async function callClaude(apiKey: string, a: Args, model: string): Promise<AppGenerationResult | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 24000,
        system: CODE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildCodeUserPrompt(a.message, currentOf(a)) }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    const cost = estimateCost(model, data?.usage?.input_tokens ?? 0, data?.usage?.output_tokens ?? 0);
    return text ? parse(text, "claude", cost, model) : null;
  } catch {
    return null;
  }
}

async function callOpenRouter(apiKey: string, a: Args, model: string): Promise<AppGenerationResult | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 24000,
        usage: { include: true },
        messages: [
          { role: "system", content: CODE_SYSTEM_PROMPT },
          { role: "user", content: buildCodeUserPrompt(a.message, currentOf(a)) },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    // OpenRouter devolve usage.cost (USD) quando disponível.
    const cost =
      typeof data?.usage?.cost === "number"
        ? data.usage.cost
        : estimateCost(model, data?.usage?.prompt_tokens ?? 0, data?.usage?.completion_tokens ?? 0);
    return text ? parse(text, "openrouter", cost, model) : null;
  } catch {
    return null;
  }
}

function demoFallback(message: string): AppGenerationResult {
  const code = `
function App(){
  const [n, setN] = useState(0);
  return React.createElement('div',{className:'min-h-full flex flex-col items-center justify-center gap-5 p-8 bg-slate-900 text-white text-center'},
    React.createElement('div',{className:'text-xs uppercase tracking-widest text-indigo-400'},'AD Studio · modo demo'),
    React.createElement('h1',{className:'text-2xl font-bold max-w-md'},'Para gerar QUALQUER app a partir do seu texto, conecte uma chave de IA em Configurações'),
    React.createElement('p',{className:'text-slate-400 max-w-md text-sm'},'Sem chave, o AD Studio executa apps prontos (jogo da velha, calculadora, lista de tarefas, pomodoro) e este exemplo abaixo.'),
    React.createElement('div',{className:'mt-2 flex items-center gap-3'},
      React.createElement('button',{onClick:function(){setN(n-1);},className:'w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 text-xl'},'-'),
      React.createElement('span',{className:'text-4xl font-bold tabular-nums w-16'},String(n)),
      React.createElement('button',{onClick:function(){setN(n+1);},className:'w-10 h-10 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xl'},'+')
    )
  );
}`;
  return {
    provider: "demo",
    engineMode: "demo",
    stats: codeStats(code),
    reply:
      "⚠️ MODO DEMO — nenhuma IA está conectada, então este NÃO é código gerado a partir do seu pedido: é um app de demonstração fixo. Conecte uma chave de IA em Configurações para gerar de verdade.",
    plan: ["Verificar provedor de IA", "Nenhuma chave encontrada", "Carregar app de DEMONSTRAÇÃO (não é geração real)"],
    app: { kind: "app", name: message.slice(0, 40) || "App", description: "", code, provider: "demo" },
    cost: 0,
    model: "demo",
  };
}

export async function generateAppWithProviders(a: Args): Promise<AppGenerationResult> {
  const isRefinement = !!(a.currentFiles?.length || a.currentCode);
  const tier = pickTier(a.costMode ?? "auto", { isApp: true, isRefinement, message: a.message });

  // 1) chave do usuário
  if (a.userKey && a.userProvider === "claude") {
    const r = await callClaude(a.userKey, a, modelFor(tier, "claude"));
    if (r) return r;
  }
  if (a.userKey && a.userProvider === "openrouter") {
    const r = await callOpenRouter(a.userKey, a, modelFor(tier, "openrouter"));
    if (r) return r;
    // fallback: tenta o modelo premium se o econômico falhar
    if (tier === "economy") {
      const r2 = await callOpenRouter(a.userKey, a, modelFor("premium", "openrouter"));
      if (r2) return r2;
    }
  }
  // 2/3) ambiente
  if (process.env.ANTHROPIC_API_KEY && a.userProvider !== "local") {
    const r = await callClaude(process.env.ANTHROPIC_API_KEY, a, modelFor(tier, "claude"));
    if (r) return r;
  }
  if (process.env.OPENROUTER_API_KEY && a.userProvider !== "local") {
    const r = await callOpenRouter(process.env.OPENROUTER_API_KEY, a, modelFor(tier, "openrouter"));
    if (r) return r;
  }
  // Em MODO REAL forçado, nunca entregamos template/demo disfarçado:
  // devolvemos o demo explícito e a rota converte em erro claro (needsKey).
  if (a.forceReal) {
    return demoFallback(a.message);
  }

  // 4) template enlatado (só na primeira geração, quando permitido)
  if (!isRefinement && a.allowTemplate) {
    const t = matchTemplate(a.message);
    if (t) {
      return {
        provider: "template",
        engineMode: "template",
        stats: codeStats(t.code),
        reply: `📦 TEMPLATE PRONTO (não é geração por IA): ${t.reply}`,
        plan: t.plan,
        app: { kind: "app", name: t.name, description: "", code: t.code, provider: "template" },
        cost: 0,
        model: "template",
      };
    }
  }
  return demoFallback(a.message);
}
