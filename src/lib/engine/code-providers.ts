/**
 * Provedores de geração de CÓDIGO (server-only) — o núcleo do clone do Lovable.
 *
 * Ordem: chave do usuário → ANTHROPIC_API_KEY → OPENROUTER_API_KEY → template.
 * Com uma chave de IA, gera código React arbitrário para QUALQUER pedido.
 * Sem chave, cai para a biblioteca de apps prontos (modo demo).
 */
import { AppGenerationResult } from "./app-types";
import { CODE_SYSTEM_PROMPT, buildCodeUserPrompt } from "./code-prompts";
import { matchTemplate } from "./code-templates";

interface Args {
  message: string;
  currentCode: string | null;
  name: string;
  userKey?: string | null;
  userProvider?: "claude" | "openrouter" | "local" | null;
}

function parse(text: string, provider: "claude" | "openrouter"): AppGenerationResult | null {
  try {
    const raw = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    const j = JSON.parse(raw);
    if (typeof j.code !== "string" || !j.code.includes("function App")) return null;
    return {
      provider,
      reply: String(j.reply ?? "Pronto! App atualizado."),
      plan: Array.isArray(j.plan) ? j.plan.map(String) : [],
      app: { kind: "app", name: j.name || "App", description: "", code: j.code, provider },
    };
  } catch {
    return null;
  }
}

async function callClaude(apiKey: string, a: Args): Promise<AppGenerationResult | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16000,
        system: CODE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildCodeUserPrompt(a.message, a.currentCode) }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    return text ? parse(text, "claude") : null;
  } catch {
    return null;
  }
}

async function callOpenRouter(apiKey: string, a: Args): Promise<AppGenerationResult | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        max_tokens: 16000,
        messages: [
          { role: "system", content: CODE_SYSTEM_PROMPT },
          { role: "user", content: buildCodeUserPrompt(a.message, a.currentCode) },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return text ? parse(text, "openrouter") : null;
  } catch {
    return null;
  }
}

/** App de fallback quando não há chave e o pedido não casa com um template. */
function demoFallback(message: string): AppGenerationResult {
  const code = `
function App(){
  const [n, setN] = useState(0);
  return React.createElement('div',{className:'min-h-full flex flex-col items-center justify-center gap-5 p-8 bg-slate-900 text-white text-center'},
    React.createElement('div',{className:'text-xs uppercase tracking-widest text-indigo-400'},'Nexaform · modo demo'),
    React.createElement('h1',{className:'text-2xl font-bold max-w-md'},'Para gerar QUALQUER app a partir do seu texto, conecte uma chave de IA em Configurações'),
    React.createElement('p',{className:'text-slate-400 max-w-md text-sm'},'Sem chave, o Nexaform executa apps prontos (jogo da velha, calculadora, lista de tarefas, pomodoro) e este exemplo abaixo. Com uma chave da Anthropic ou OpenRouter, ele escreve o código do que voce pedir.'),
    React.createElement('div',{className:'mt-2 flex items-center gap-3'},
      React.createElement('button',{onClick:function(){setN(n-1);},className:'w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 text-xl'},'-'),
      React.createElement('span',{className:'text-4xl font-bold tabular-nums w-16'},String(n)),
      React.createElement('button',{onClick:function(){setN(n+1);},className:'w-10 h-10 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xl'},'+')
    )
  );
}`;
  return {
    provider: "template",
    reply:
      "Sem uma chave de IA configurada, só consigo executar apps prontos ou este exemplo. Conecte uma chave da Anthropic/OpenRouter em Configurações para eu escrever o código de qualquer app que você descrever.",
    plan: ["Verificar provedor de IA", "Nenhuma chave encontrada", "Carregar app de demonstração"],
    app: { kind: "app", name: message.slice(0, 40) || "App", description: "", code, provider: "template" },
  };
}

export async function generateAppWithProviders(a: Args): Promise<AppGenerationResult> {
  // 1) chave do usuário
  if (a.userKey && a.userProvider === "claude") {
    const r = await callClaude(a.userKey, a);
    if (r) return r;
  }
  if (a.userKey && a.userProvider === "openrouter") {
    const r = await callOpenRouter(a.userKey, a);
    if (r) return r;
  }
  // 2/3) ambiente
  if (process.env.ANTHROPIC_API_KEY && a.userProvider !== "local") {
    const r = await callClaude(process.env.ANTHROPIC_API_KEY, a);
    if (r) return r;
  }
  if (process.env.OPENROUTER_API_KEY && a.userProvider !== "local") {
    const r = await callOpenRouter(process.env.OPENROUTER_API_KEY, a);
    if (r) return r;
  }
  // 4) template gratuito (só na primeira geração; refinamento sem IA não altera)
  if (!a.currentCode) {
    const t = matchTemplate(a.message);
    if (t) {
      return {
        provider: "template",
        reply: t.reply,
        plan: t.plan,
        app: { kind: "app", name: t.name, description: "", code: t.code, provider: "template" },
      };
    }
  }
  return demoFallback(a.message);
}
