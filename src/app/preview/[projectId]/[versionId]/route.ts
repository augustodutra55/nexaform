import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { buildMultiFileSrcDoc } from "@/lib/preview/multi-file-srcdoc";
import { isAppCode, isMultiFile, type AppCode, type AppFile } from "@/lib/engine/app-types";

/**
 * Preview iframe sandbox — HTML server-side de uma versão (Fase 4).
 *
 * GET /preview/[projectId]/[versionId]
 *
 * Carrega o schema (AppCode) da versão e serializa o documento com
 * `buildMultiFileSrcDoc` (multi-file-srcdoc.ts) — o mesmo runtime multi-arquivo
 * do editor (AppRunner), que compila os arquivos DENTRO do iframe via Babel e
 * embute a ponte de erros + `runtime-audit` (nxPostAudit/__nx_error via
 * postMessage). O bundler esbuild (bundler.ts) é browser-only, por isso o
 * preview navegável usa este runtime server-safe. O <preview-pane> aponta o
 * iframe para esta URL. Servido com text/html.
 *
 * Isolamento: o iframe usa sandbox="allow-scripts" (ver preview-pane.tsx), que
 * executa o código gerado em origem opaca mesmo sendo mesma-origem — por isso
 * NÃO usamos allow-same-origin, preservando o invariante de segurança do
 * AppRunner (o código gerado nunca alcança cookies/sessão reais).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// App mínimo determinístico para o harness de e2e (sem depender de banco).
const E2E_FILES: AppFile[] = [
  {
    path: "App.jsx",
    content:
      "export default function App(){ return (<main data-testid=\"preview-root\" className=\"p-6 text-lg font-semibold\">Preview OK</main>); }",
  },
];

function versionFiles(schema: AppCode): { files: AppFile[]; entry: string } {
  if (isMultiFile(schema)) return { files: schema.files, entry: schema.entry };
  if (typeof schema.code === "string") return { files: [{ path: "App.jsx", content: schema.code }], entry: "App.jsx" };
  return { files: [], entry: "App.jsx" };
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Documento isolado: nunca deve ser embutido fora do próprio app.
      "x-frame-options": "SAMEORIGIN",
    },
  });
}

function errorDocument(message: string): string {
  const safe = message.replace(/</g, "&lt;");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>body{margin:0;font-family:ui-monospace,Menlo,monospace;background:#fef2f2;color:#b91c1c;padding:20px;font-size:13px;line-height:1.5}</style></head><body><div data-testid="preview-error">⚠ ${safe}</div><script>try{window.parent.postMessage({__nx_error:${JSON.stringify(message.slice(0, 800))}},'*')}catch(e){}</script></body></html>`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; versionId: string }> }
) {
  const { projectId, versionId } = await params;

  // Harness de e2e: sem banco, serve um app mínimo com a mesma ponte de runtime.
  if (process.env.E2E_TEST_MODE === "1" && projectId === "e2e") {
    return htmlResponse(buildMultiFileSrcDoc(E2E_FILES, "App.jsx", projectId));
  }

  if (!isUuid(projectId) || !isUuid(versionId)) {
    return htmlResponse(errorDocument("Projeto ou versão inválidos."), 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return htmlResponse(errorDocument("Faça login para visualizar o preview."), 401);

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return htmlResponse(errorDocument("Você não tem acesso a este projeto."), access.status ?? 403);
  }

  const { data: version, error } = await supabase
    .from("versions")
    .select("id, project_id, schema")
    .eq("id", versionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return htmlResponse(errorDocument("Não foi possível carregar a versão."), 503);
  if (!version) return htmlResponse(errorDocument("Versão não encontrada."), 404);
  if (!isAppCode(version.schema)) {
    return htmlResponse(errorDocument("Esta versão não é um aplicativo executável."), 422);
  }

  const { files, entry } = versionFiles(version.schema as AppCode);
  if (!files.length) return htmlResponse(errorDocument("A versão não tem arquivos para renderizar."), 422);

  return htmlResponse(buildMultiFileSrcDoc(files, entry, projectId));
}
