import type { AppCode, AppFile } from "./app-types";

export interface AppInboundEndpoint {
  name: string;
  collection: string;
}

const NAME_RE = /^[a-z][a-z0-9_-]{0,59}$/;
const COLLECTION_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;

function filesOf(app: AppCode): AppFile[] {
  return app.files?.length ? app.files : [{ path: "App.jsx", content: app.code || "" }];
}

/** Endpoints declarativos para receber eventos normalizados de Make/Zapier/n8n. */
export function buildInboundBlueprint(app: AppCode): { inbound: AppInboundEndpoint[]; warnings: string[] } {
  const inbound = new Map<string, AppInboundEndpoint>();
  const warnings: string[] = [];
  for (const file of filesOf(app)) {
    for (const line of file.content.split(/\r?\n/)) {
      const marker = line.indexOf("AD_BACKEND:");
      if (marker < 0) continue;
      try {
        const manifest = JSON.parse(line.slice(marker + "AD_BACKEND:".length).trim().replace(/\*\/\s*$/, "").trim());
        if (!Array.isArray(manifest?.inbound)) continue;
        for (const raw of manifest.inbound.slice(0, 10)) {
          const name = typeof raw?.name === "string" ? raw.name.trim() : "";
          const collection = typeof raw?.collection === "string" ? raw.collection.trim() : "";
          if (!NAME_RE.test(name) || !COLLECTION_RE.test(collection)) {
            warnings.push("Um endpoint de entrada inválido foi ignorado.");
            continue;
          }
          if (inbound.has(name)) {
            warnings.push(`Endpoint de entrada duplicado ignorado: ${name}.`);
            continue;
          }
          inbound.set(name, { name, collection });
        }
      } catch {
        // Manifesto inválido já é tratado pelos demais blueprints.
      }
    }
  }
  return { inbound: Array.from(inbound.values()), warnings };
}
