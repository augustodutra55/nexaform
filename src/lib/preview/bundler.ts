"use client";

/**
 * Bundler real no navegador (esbuild-wasm) — o que aproxima o AD Studio do Lovable.
 *
 * - Empacota os arquivos do projeto (imports relativos resolvidos da memória).
 * - Imports "bare" (qualquer pacote npm) viram EXTERNOS apontando para esm.sh,
 *   que serve builds ESM de praticamente qualquer pacote JS puro — sem npm install.
 * - React/ReactDOM ficam externos e são resolvidos por um import map único no
 *   iframe, garantindo UMA instância de React (evita o clássico "dois Reacts").
 *
 * Se o esbuild não carregar ou o bundle falhar, o AppRunner cai no runtime
 * Babel anterior (multi-arquivo), então o que já funcionava continua funcionando.
 */
import type { AppFile } from "@/lib/engine/app-types";

const ESBUILD_VERSION = "0.20.2";
const REACT_VERSION = "18.2.0";

let _initPromise: Promise<any> | null = null;

/** Carrega e inicializa o esbuild-wasm uma única vez (idempotente). */
async function getEsbuild(): Promise<any> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const w = window as any;
    if (!w.esbuild) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/lib/browser.min.js`;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Falha ao carregar o esbuild."));
        document.head.appendChild(s);
      });
    }
    const esbuild = (window as any).esbuild;
    if (!esbuild.__nx_ready) {
      await esbuild.initialize({
        wasmURL: `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`,
        worker: true,
      });
      esbuild.__nx_ready = true;
    }
    return esbuild;
  })().catch((e) => {
    _initPromise = null; // permite retry
    throw e;
  });
  return _initPromise;
}

function norm(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (const s of parts) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}
function loaderFor(path: string): "ts" | "tsx" | "js" | "jsx" {
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".js")) return "js";
  return "jsx";
}

/** Pacotes resolvidos pelo import map (React único). Não vão para esm.sh soltos. */
const IMPORT_MAP_KEYS = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

export interface BundleResult {
  code: string;
  /** Pacotes npm externos detectados (para info/export). */
  packages: string[];
}

/**
 * Empacota o projeto em um único módulo ESM. Bare imports ficam externos
 * (react via import map; demais via esm.sh com ?external=react,react-dom).
 */
export async function bundleApp(files: AppFile[], entry: string): Promise<BundleResult> {
  const esbuild = await getEsbuild();
  const map: Record<string, string> = {};
  for (const f of files) map[f.path.replace(/^\.?\//, "")] = f.content;
  const entryPath = entry.replace(/^\.?\//, "");
  const packages = new Set<string>();

  const candidates = (base: string) => [
    base,
    base + ".tsx",
    base + ".jsx",
    base + ".ts",
    base + ".js",
    base + "/index.tsx",
    base + "/index.jsx",
    base + "/index.ts",
    base + "/index.js",
  ];
  const resolveLocal = (importer: string, spec: string): string | null => {
    const dir = importer.includes("/") ? importer.replace(/\/[^/]*$/, "") : "";
    const target = norm((dir ? dir + "/" : "") + spec);
    for (const c of candidates(target)) if (map[c] != null) return c;
    return null;
  };

  const BOOT = "__nx_boot__";
  const bootCode =
    `import React from 'react';\n` +
    `import { createRoot } from 'react-dom/client';\n` +
    `import App from '${entryPath}';\n` +
    `createRoot(document.getElementById('root')).render(React.createElement(App));\n`;

  const result = await esbuild.build({
    entryPoints: [BOOT],
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    target: "es2020",
    logLevel: "silent",
    plugins: [
      {
        name: "nx-virtual",
        setup(build: any) {
          build.onResolve({ filter: /.*/ }, (args: any) => {
            if (args.path === BOOT) return { path: BOOT, namespace: "nx" };
            // imports relativos → arquivos em memória
            if (args.path.startsWith(".") || args.importer === BOOT) {
              if (args.path.startsWith(".")) {
                const p = resolveLocal(args.importer === BOOT ? "" : args.importer, args.path);
                if (p) return { path: p, namespace: "nx" };
              } else {
                // do boot: entry local ou bare
                const p = resolveLocal("", args.path);
                if (p) return { path: p, namespace: "nx" };
              }
            }
            // React e afins → externos, resolvidos pelo import map (React único)
            if (IMPORT_MAP_KEYS.has(args.path)) return { path: args.path, external: true };
            // qualquer outro pacote npm → esm.sh externo, usando o React do import map
            const clean = args.path.split("/")[0].replace(/^@[^/]+\//, "");
            packages.add(args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : clean);
            const url = `https://esm.sh/${args.path}?external=react,react-dom`;
            return { path: url, external: true };
          });
          build.onLoad({ filter: /.*/, namespace: "nx" }, (args: any) => {
            if (args.path === BOOT) return { contents: bootCode, loader: "tsx" };
            const content = map[args.path];
            if (content == null) return { errors: [{ text: `Arquivo não encontrado: ${args.path}` }] };
            return { contents: content, loader: loaderFor(args.path) };
          });
        },
      },
    ],
  });

  const out = result.outputFiles?.[0]?.text;
  if (!out) throw new Error("O bundler não produziu saída.");
  return { code: out, packages: Array.from(packages) };
}

/** HTML do iframe: import map (React único) + Tailwind + bundle ESM + ponte de erros. */
export function buildBundledSrcDoc(bundledCode: string): string {
  const importMap = {
    imports: {
      react: `https://esm.sh/react@${REACT_VERSION}`,
      "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
      "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-dev-runtime`,
      "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}`,
      "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client`,
    },
  };
  const codeJson = JSON.stringify(bundledCode);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script type="importmap">${JSON.stringify(importMap)}</script>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html,body,#root{height:100%;margin:0}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0b1020;color:#0f172a}
  #root{background:#ffffff;min-height:100%}
  .nx-error{padding:20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#b91c1c;background:#fef2f2;white-space:pre-wrap;height:100%;box-sizing:border-box;overflow:auto;font-size:13px;line-height:1.5}
</style>
</head>
<body>
<div id="root"></div>
<script>
  var _nxHost = window.parent;
  var _nxReported = false;
  function nxReport(msg){ if(_nxReported) return; _nxReported=true; try{ _nxHost.postMessage({ __nx_error:String(msg).slice(0,800) }, '*'); }catch(e){} }
  function showError(msg){ var r=document.getElementById('root'); if(r) r.innerHTML='<div class="nx-error">⚠ Erro ao executar o app:\\n\\n'+String(msg).replace(/</g,'&lt;')+'</div>'; }
  window.addEventListener('error', function(e){ var m=(e.error && e.error.message) || e.message; showError(m); nxReport(m); });
  window.addEventListener('unhandledrejection', function(e){ var m=(e.reason && e.reason.message) || String(e.reason); showError(m); nxReport(m); });
  try { Object.defineProperty(window, 'parent', { get: function(){ return window; } }); } catch(e){}
  try { Object.defineProperty(window, 'top', { get: function(){ return window; } }); } catch(e){}
</script>
<script type="module">
(async () => {
  try {
    const blob = new Blob([${codeJson}], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    await import(url);
  } catch (e) {
    var m = (e && e.message) || String(e);
    var r = document.getElementById('root');
    if (r) r.innerHTML = '<div class="nx-error">⚠ Erro ao executar o app:\\n\\n'+String(m).replace(/</g,'&lt;')+'</div>';
    try{ window.parent.postMessage({ __nx_error:String(m).slice(0,800) }, '*'); }catch(_){}
  }
})();
</script>
</body>
</html>`;
}
