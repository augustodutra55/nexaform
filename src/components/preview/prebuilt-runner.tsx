"use client";

import { useMemo } from "react";
import { buildBundledSrcDoc } from "@/lib/preview/bundler";

/**
 * Runner do app PUBLICADO usando o bundle já pré-compilado no momento da
 * publicação (coluna projects.build_bundle). Diferente do AppRunner, NÃO carrega
 * @babel/standalone nem esbuild-wasm — só injeta o bundle pronto + React (esm.sh)
 * + Tailwind. Resultado: site publicado leve e rápido. É usado apenas quando há
 * bundle salvo; caso contrário a página pública cai no AppRunner (fallback).
 */
export function PrebuiltRunner({ bundle, projectId }: { bundle: string; projectId?: string | null }) {
  const srcDoc = useMemo(
    () => buildBundledSrcDoc(bundle, projectId ?? null, { published: true }),
    [bundle, projectId]
  );
  return (
    <iframe
      title="App publicado"
      sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-modals"
      srcDoc={srcDoc}
      className="h-full w-full border-0 bg-white"
    />
  );
}
