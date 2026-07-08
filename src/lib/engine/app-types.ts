/**
 * Modo "App" do AD Studio — geração de aplicativos React funcionais.
 *
 * Diferente do modo "site" (schema de seções), aqui o projeto guarda o
 * CÓDIGO-FONTE de um componente React (`App`) que é executado no navegador
 * pelo AppRunner. É o que torna o AD Studio um clone real do Lovable:
 * jogos, ferramentas e apps com lógica de verdade.
 *
 * Ambos os modos coexistem no mesmo campo `projects.schema` (jsonb),
 * discriminados por `kind`. Assim não é preciso alterar o banco.
 */

export type Provider = "template" | "demo" | "claude" | "openrouter";

/**
 * Modo do motor nesta geração — transparência total, sem demo disfarçado:
 *  - "real":     a IA escreveu o código do zero a partir do seu prompt.
 *  - "template": código enlatado pronto (não foi a IA que escreveu).
 *  - "demo":     nenhuma IA conectada; app de demonstração fixo.
 */
export type EngineMode = "real" | "template" | "demo";

/** Um arquivo do projeto multi-arquivo (ex.: components/Header.jsx). */
export interface AppFile {
  path: string;
  content: string;
}

export interface AppCode {
  kind: "app";
  name: string;
  description: string;
  /**
   * Single-file (legado): código de um componente React `App`.
   * Continua suportado; se `files` estiver presente, ele tem prioridade.
   */
  code?: string;
  /** Multi-arquivo real: vários módulos com imports entre si. */
  files?: AppFile[];
  /** Arquivo de entrada do projeto multi-arquivo (default export = App). */
  entry?: string;
  /** Provedor que gerou o código. */
  provider?: Provider;
}

/** true se o AppCode é um projeto multi-arquivo (com imports reais). */
export function isMultiFile(app: AppCode | null | undefined): app is AppCode & { files: AppFile[]; entry: string } {
  return !!app && Array.isArray(app.files) && app.files.length > 0 && typeof app.entry === "string";
}

/** Métricas do código gerado — prova técnica de que há código real. */
export interface CodeStats {
  lines: number;
  components: number;
  hooks: number;
  handlers: number;
  /** Nº de arquivos (1 para single-file). */
  files: number;
}

export interface AppGenerationResult {
  reply: string;
  plan: string[];
  app: AppCode;
  provider: Provider;
  /** Modo do motor: real (IA escreveu), template (enlatado) ou demo. */
  engineMode: EngineMode;
  /** Métricas do código para exibir como evidência técnica. */
  stats?: CodeStats;
  /** Custo real desta geração em USD (0 para template/demo). */
  cost?: number;
  /** Modelo usado (para transparência de custo). */
  model?: string;
  /** Quando a IA não gerou (demo/template em modo real): motivo técnico real
   *  da falha (ex.: "modelo X indisponível (404)", "chave rejeitada (401)",
   *  "tempo esgotado"). Usado para dar um erro honesto ao usuário. */
  failureReason?: string;
}

export function isAppCode(value: any): value is AppCode {
  if (!value || value.kind !== "app") return false;
  const hasCode = typeof value.code === "string" && value.code.length > 0;
  const hasFiles = Array.isArray(value.files) && value.files.length > 0;
  return hasCode || hasFiles;
}

/** Extrai métricas de um trecho de código (linhas, componentes, hooks, handlers). */
export function codeStats(code: string): CodeStats {
  const lines = code.trim() ? code.trim().split(/\r?\n/).length : 0;
  const components =
    (code.match(/function\s+[A-Z]\w*\s*\(/g) || []).length +
    (code.match(/const\s+[A-Z]\w*\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g) || []).length;
  const hooks = (code.match(/\buse[A-Z]\w*\s*\(/g) || []).length;
  const handlers = (code.match(/\bon[A-Z]\w*\s*[=:]/g) || []).length;
  return { lines, components: Math.max(components, 1), hooks, handlers, files: 1 };
}

/** Métricas somadas de um projeto multi-arquivo. */
export function projectStats(app: AppCode): CodeStats {
  if (isMultiFile(app)) {
    const acc: CodeStats = { lines: 0, components: 0, hooks: 0, handlers: 0, files: app.files.length };
    for (const f of app.files) {
      const s = codeStats(f.content);
      acc.lines += s.lines;
      acc.components += s.components;
      acc.hooks += s.hooks;
      acc.handlers += s.handlers;
    }
    acc.components = Math.max(acc.components, 1);
    return acc;
  }
  return codeStats(app.code ?? "");
}

/**
 * Decide se um pedido é um APP funcional (jogo/ferramenta/lógica) ou um
 * SITE (páginas de conteúdo). Determina qual engine usar.
 */
export function looksLikeApp(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const appHints =
    /\b(jogo|jogar|game|xadrez|chess|dama|velha|tic.?tac|sudoku|quiz|calculadora|calcular|conversor|converter|cron[oô]metro|timer|pomodoro|contador|lista de tarefas|to.?do|afazeres|bloco de notas|notas|desenh|paint|piano|teclado|snake|cobrinha|2048|memória|memory|forca|hangman|relógio|clock|agenda|kanban|planilha|rastreador|tracker|simulador|física|gerador de senha|password|qr code|markdown|editor|whiteboard|tabuleiro|dado|dice|roleta|sorteio|caça.?palavra|palavra|wordle|termo)\b/;
  const toolHints = /\b(interativ|funcional|com l[óo]gica|que funcione|jog[áa]vel|clique|arrast|drag|estado|score|pontua)\b/;
  return appHints.test(p) || toolHints.test(p);
}
