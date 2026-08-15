import ts from "typescript";

const SCRIPT_EXTENSIONS = ["", ".jsx", ".js", ".tsx", ".ts"];

function normalizePath(path) {
  const parts = String(path || "").replace(/\\/g, "/").split("/");
  const result = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}

function dirname(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function importSources(content) {
  const sources = [];
  const pattern = /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+|import\s*\()(["'])([^"']+)\1/g;
  let match;
  while ((match = pattern.exec(content))) sources.push(match[2]);
  return sources;
}

function resolvesRelative(from, source, paths) {
  const base = normalizePath(`${dirname(from)}/${source}`);
  for (const extension of SCRIPT_EXTENSIONS) {
    if (paths.has(`${base}${extension}`)) return true;
    if (paths.has(`${base}/index${extension || ".jsx"}`)) return true;
  }
  return false;
}

function syntaxErrors(file) {
  if (!/\.(?:jsx|tsx|js|ts)$/i.test(file.path)) return [];
  try {
    const result = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
      },
    });
    return (result.diagnostics || [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  } catch (reason) {
    return [`Transpilação falhou: ${reason instanceof Error ? reason.message : String(reason)}`];
  }
}

function check(id, label, passed, detail, blocking = false) {
  return { id, label, passed: !!passed, detail, blocking };
}

const SCENARIO_RULES = {
  landing: [
    ["hero", "Hero principal", /<h1\b/i],
    ["form", "Formulário funcional", /<form\b|onSubmit\s*=/i],
    ["benefits", "Benefícios", /benef[ií]cio|vantagem|resultado|solu[çc][aã]o/i],
    ["social-proof", "Prova social", /depoimento|testimonial|case|clientes|prova social/i],
    ["faq", "FAQ", /\bfaq\b|perguntas frequentes/i],
    ["cta", "CTA recorrente", /cta|fale conosco|agend|solicite|come[çc]ar|contato/i],
  ],
  agenda: [
    ["auth", "Login e cadastro", /AD\s*\.\s*auth|login|entrar|cadastro|signIn|signUp/i],
    ["schedule", "Agenda por data e horário", /agenda|agendamento|hor[aá]rio|calendar|date/i],
    ["clients", "Cadastro de clientes", /cliente|paciente/i],
    ["operations", "Confirmação, reagendamento e cancelamento", /confirm[ae]|reagend|cancel/i],
    ["states", "Estados operacionalizados", /carreg|loading|vazio|empty|erro|error/i],
    ["data", "Persistência real", /(?:window\.)?AD\s*\.\s*(?:data|list|get|create|update|remove)/i],
  ],
  dashboard: [
    ["kpis", "KPIs", /\bkpi\b|indicador|receita|convers[aã]o|faturamento/i],
    ["clients", "Clientes", /cliente/i],
    ["funnel", "Funil comercial", /funil|pipeline/i],
    ["tasks", "Tarefas", /tarefa|task/i],
    ["filters", "Filtros e busca", /filtro|filter|busca|search/i],
    ["data", "Dados reais", /(?:window\.)?AD\s*\.\s*(?:data|list|get|create|update|remove)/i],
  ],
  commerce: [
    ["catalog", "Catálogo e produtos", /cat[aá]logo|produto|product/i],
    ["search", "Busca", /busca|pesquisa|search/i],
    ["price", "Preço", /pre[çc]o|price|R\$/i],
    ["cart", "Carrinho", /carrinho|cart/i],
    ["checkout", "Jornada de checkout", /checkout|finalizar (?:a )?(?:compra|pedido)|resumo do pedido|continuar para (?:o )?pagamento/i],
    ["social-proof", "Prova social", /depoimento|testimonial|avalia[çc][aã]o|estrelas|clientes/i],
    ["faq", "FAQ", /\bfaq\b|perguntas frequentes/i],
  ],
  media: [
    ["video", "Área de vídeo", /<video\b/i],
    ["controls", "Controles do vídeo", /<video[^>]*\bcontrols\b/i],
    ["placeholder", "Placeholder seguro", /data-ad-media\s*=\s*["']video["']/i],
    ["fallback", "Fallback acessível", /<video[^>]*(?:aria-label|poster)\s*=/i],
  ],
};

export function evaluateGoldenCandidate(id, data) {
  const files = Array.isArray(data?.app?.files)
    ? data.app.files.filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
    : [];
  const paths = new Set(files.map((file) => normalizePath(file.path)));
  const entry = normalizePath(data?.app?.entry || "");
  const source = files.map((file) => file.content).join("\n");
  const checks = [];

  checks.push(check("real-engine", "Motor real", data?.engineMode === "real", `engineMode=${String(data?.engineMode || "ausente")}`, true));
  checks.push(check("multi-file", "Projeto multi-arquivo", files.length >= 2, `${files.length} arquivo(s)`, true));
  checks.push(check("entry", "Entrada existente", !!entry && paths.has(entry), entry || "entry ausente", true));

  const brokenImports = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    for (const imported of importSources(file.content)) {
      if (imported.startsWith(".") && !resolvesRelative(path, imported, paths)) {
        brokenImports.push(`${path} -> ${imported}`);
      }
    }
  }
  checks.push(check("imports", "Imports relativos", brokenImports.length === 0, brokenImports.join("; ") || "todos resolvidos", true));

  const syntax = files.flatMap((file) => syntaxErrors(file).map((message) => `${file.path}: ${message}`));
  checks.push(check("syntax", "Sintaxe JSX/TSX", syntax.length === 0, syntax.slice(0, 4).join("; ") || "transpilação aprovada", true));
  checks.push(check("quality", "Quality gate do servidor", data?.quality?.valid === true, data?.quality ? `nota ${data.quality.score}/100` : "relatório ausente", true));
  checks.push(check("no-demo", "Sem fallback disfarçado", !/AD Studio\s*[·-]\s*modo demo|conecte uma chave de IA/i.test(source), "nenhum marcador de demo", true));

  const rules = SCENARIO_RULES[id] || [];
  for (const [ruleId, label, pattern] of rules) {
    const matched = pattern.test(source);
    checks.push(check(`semantic-${ruleId}`, label, matched, matched ? "evidência encontrada no código" : "evidência ausente"));
  }
  if (id === "media") {
    const inventedVideo = /https?:\/\/[^\s"']+\.(?:mp4|webm)(?:[?"']|$)/i.test(source);
    checks.push(check("semantic-no-invented-video", "Sem vídeo inventado", !inventedVideo, inventedVideo ? "URL de vídeo não confiável detectada" : "nenhuma URL fictícia detectada", true));
  }

  const blockers = checks.filter((item) => item.blocking && !item.passed);
  const semantic = checks.filter((item) => item.id.startsWith("semantic-") && item.id !== "semantic-no-invented-video");
  const semanticPassed = semantic.filter((item) => item.passed).length;
  const semanticRate = semantic.length ? semanticPassed / semantic.length : 1;
  const passedCount = checks.filter((item) => item.passed).length;
  const score = checks.length ? Math.round((passedCount / checks.length) * 100) : 0;
  return {
    passed: blockers.length === 0 && semanticRate >= 0.85 && score >= 85,
    score,
    semanticRate: Math.round(semanticRate * 100),
    checks,
    blockers: blockers.map((item) => item.id),
  };
}
