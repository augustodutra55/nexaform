"use client";
import { useEffect, type RefObject } from "react";

type BridgeKind = "data" | "upload" | "email" | "view" | "auth";
const METHODS: Record<BridgeKind, string[]> = {
  data: ["GET", "POST", "PATCH", "DELETE"], upload: ["POST"],
  email: ["POST"], view: ["POST"], auth: ["GET", "POST"],
};
const sessionKey = (projectId: string) => `adstudio:app-token:${projectId}`;

export function usePreviewBridge(
  iframeRef: RefObject<HTMLIFrameElement>, projectId?: string | null,
  onError?: (message: string) => void, allowEditorSession = false
) {
  useEffect(() => {
    function reply(source: Window, id: string, result: Record<string, unknown>) {
      source.postMessage({ __ad_bridge_result: true, id, ...result }, "*");
    }
    async function onMessage(event: MessageEvent) {
      const source = iframeRef.current?.contentWindow;
      if (!source || event.source !== source || !event.data || typeof event.data !== "object") return;
      if (typeof event.data.__nx_error === "string") { onError?.(event.data.__nx_error.slice(0, 800)); return; }
      if (event.data.__ad_bridge !== true) return;
      const id = typeof event.data.id === "string" ? event.data.id.slice(0, 100) : "";
      const kind = event.data.kind as BridgeKind;
      const method = typeof event.data.method === "string" ? event.data.method.toUpperCase() : "GET";
      if (!id || !projectId || event.data.projectId !== projectId || !METHODS[kind]?.includes(method)) {
        reply(source, id, { ok: false, status: 403, error: "Operação não permitida no preview." }); return;
      }
      const rawQs = typeof event.data.qs === "string" ? event.data.qs : "";
      const qs = rawQs.startsWith("?") && rawQs.length <= 5000 && !rawQs.includes("#") ? rawQs : "";
      const paths: Record<BridgeKind, string> = {
        data: `/api/data/${projectId}`, upload: `/api/upload/${projectId}`,
        email: `/api/email/${projectId}`, view: `/api/view/${projectId}`, auth: `/api/app-auth/${projectId}`,
      };
      try {
        const headers = new Headers();
        const token = localStorage.getItem(sessionKey(projectId));
        if (token && kind !== "view") headers.set("authorization", `Bearer ${token}`);
        let body: BodyInit | undefined;
        if (kind === "upload") {
          if (!(event.data.file instanceof Blob)) throw new Error("Arquivo inválido.");
          const form = new FormData();
          form.append("file", event.data.file, String(event.data.fileName || "arquivo").slice(0, 180)); body = form;
        } else if (event.data.body !== undefined && method !== "GET") {
          headers.set("content-type", "application/json"); body = JSON.stringify(event.data.body);
        }
        const response = await fetch(paths[kind] + qs, { method, headers, body,
          credentials: allowEditorSession ? "same-origin" : "omit", keepalive: kind === "view" });
        const text = await response.text();
        let payload: any = {};
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: "Resposta inválida do servidor." }; }
        if (kind === "auth" && response.ok) {
          const action = event.data.body?.action;
          if ((action === "signup" || action === "login") && typeof payload.token === "string") localStorage.setItem(sessionKey(projectId), payload.token);
          else if (action === "logout") localStorage.removeItem(sessionKey(projectId));
        }
        reply(source, id, { ok: response.ok, status: response.status, payload,
          error: response.ok ? undefined : payload?.error || `Erro ${response.status}` });
      } catch (error) {
        reply(source, id, { ok: false, status: 500,
          error: error instanceof Error ? error.message : "Falha na comunicação com o app." });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allowEditorSession, iframeRef, onError, projectId]);
}
