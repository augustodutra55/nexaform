"use client";
import { useEffect, type RefObject } from "react";

type BridgeKind = "data" | "upload" | "email" | "view" | "auth" | "voice";
const METHODS: Record<BridgeKind, string[]> = {
  data: ["GET", "POST", "PATCH", "DELETE"], upload: ["POST"],
  email: ["POST"], view: ["POST"], auth: ["GET", "POST"], voice: ["POST"],
};
const sessionKey = (projectId: string) => `adstudio:app-token:${projectId}`;

function speechVoiceScore(voice: SpeechSynthesisVoice, requestedLang: string): number {
  const requested = String(requestedLang || "pt-BR").toLowerCase().replace("_", "-");
  const language = String(voice.lang || "").toLowerCase().replace("_", "-");
  if (language.split("-")[0] !== requested.split("-")[0]) return -100_000;
  const name = String(voice.name || "").toLowerCase();
  let score = language === requested ? 1000 : 600;
  if (voice.localService) score += 180;
  if (voice.default) score += 30;
  if (/enhanced|premium|natural|neural/.test(name)) score += 180;
  if (/samantha|ava|allison|alex|victoria|karen|daniel|serena|tessa|fiona|moira|luciana|joana|felipe/.test(name)) score += 150;
  if (/google.*(english|portugu|brazil)|microsoft.*natural/.test(name)) score += 80;
  if (/compact|eloquence|novelty|zarvox|trinoids|whisper|boing|bubbles|cellos|organ|bells|bad news|good news/.test(name)) score -= 600;
  return score;
}

function preferredSpeechVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -100_000;
  for (const voice of voices) {
    const score = speechVoiceScore(voice, lang);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return bestScore > -100_000 ? best : null;
}

export function usePreviewBridge(
  iframeRef: RefObject<HTMLIFrameElement>, projectId?: string | null,
  onError?: (message: string) => void, allowEditorSession = false
) {
  useEffect(() => {
    let activeRecognition: any = null;
    let activeSpeechRequest = 0;
    let pendingPreviewError: number | null = null;
    const clearPendingPreviewError = () => {
      if (pendingPreviewError !== null) window.clearTimeout(pendingPreviewError);
      pendingPreviewError = null;
    };
    try { window.speechSynthesis?.getVoices(); } catch {}
    function reply(source: Window, id: string, result: Record<string, unknown>) {
      source.postMessage({ __ad_bridge_result: true, id, ...result }, "*");
    }
    function voiceError(code: string): string {
      if (code === "not-allowed" || code === "service-not-allowed") return "Permissão do microfone bloqueada. Permita o microfone no cadeado do navegador.";
      if (code === "audio-capture") return "Nenhum microfone disponível. Confira o dispositivo e tente novamente.";
      if (code === "no-speech") return "Nenhuma fala foi reconhecida. Tente novamente.";
      if (code === "network") return "O reconhecimento de voz ficou indisponível. Confira a conexão.";
      return code || "Falha ao usar o recurso de voz.";
    }
    function handleVoice(source: Window, id: string, body: any) {
      const action = String(body?.action || "");
      if (action === "cancel") {
        activeSpeechRequest++;
        try { activeRecognition?.abort(); } catch {}
        activeRecognition = null;
        try { window.speechSynthesis?.cancel(); } catch {}
        reply(source, id, { ok: true, status: 200, payload: { cancelled: true } });
        return;
      }
      if (action === "speak") {
        const speechRequest = ++activeSpeechRequest;
        const text = String(body?.text || "").trim().slice(0, 5000);
        if (!text || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
          reply(source, id, { ok: false, status: 501, error: "Leitura em voz alta não disponível neste navegador." });
          return;
        }
        try {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = String(body?.lang || "pt-BR").slice(0, 20);
          utterance.rate = Math.min(2, Math.max(0.5, Number(body?.rate) || 1));
          utterance.pitch = Math.min(2, Math.max(0, Number(body?.pitch) || 1));
          utterance.volume = Math.min(1, Math.max(0, body?.volume == null ? 1 : Number(body.volume)));
          utterance.voice = preferredSpeechVoice(window.speechSynthesis.getVoices(), utterance.lang);
          const queueWasBusy = window.speechSynthesis.speaking
            || window.speechSynthesis.pending || window.speechSynthesis.paused;
          if (queueWasBusy) window.speechSynthesis.cancel();
          const play = () => {
            if (speechRequest !== activeSpeechRequest) return;
            try {
              window.speechSynthesis.resume();
              window.speechSynthesis.speak(utterance);
              reply(source, id, { ok: true, status: 200, payload: { speaking: true } });
            } catch (error) {
              reply(source, id, { ok: false, status: 500, error: error instanceof Error ? error.message : "Falha na leitura em voz alta." });
            }
          };
          // Safari pode descartar a fala se cancel() e speak() ocorrerem juntos.
          if (queueWasBusy) window.setTimeout(play, 120); else play();
        } catch (error) {
          reply(source, id, { ok: false, status: 500, error: error instanceof Error ? error.message : "Falha na leitura em voz alta." });
        }
        return;
      }
      if (action !== "listen") {
        reply(source, id, { ok: false, status: 400, error: "Ação de voz inválida." });
        return;
      }
      const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!Recognition) {
        reply(source, id, { ok: false, status: 501, error: "Reconhecimento de voz não disponível. Use Chrome ou Edge atualizado." });
        return;
      }
      try { activeRecognition?.abort(); } catch {}
      const recognition = new Recognition();
      activeRecognition = recognition;
      recognition.lang = String(body?.lang || "pt-BR").slice(0, 20);
      recognition.interimResults = false;
      recognition.continuous = false;
      let transcript = "";
      let settled = false;
      const finish = (result: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        if (activeRecognition === recognition) activeRecognition = null;
        reply(source, id, result);
      };
      recognition.onresult = (event: any) => {
        for (let index = event.resultIndex || 0; index < event.results.length; index++) {
          transcript += event.results[index][0]?.transcript || "";
        }
      };
      recognition.onerror = (event: any) => finish({ ok: false, status: 400, error: voiceError(String(event?.error || "")) });
      recognition.onend = () => transcript.trim()
        ? finish({ ok: true, status: 200, payload: { transcript: transcript.trim() } })
        : finish({ ok: false, status: 400, error: "Nenhuma fala foi reconhecida. Tente novamente." });
      recognition.start();
    }
    async function onMessage(event: MessageEvent) {
      const source = iframeRef.current?.contentWindow;
      if (!source || event.source !== source || !event.data || typeof event.data !== "object") return;
      if (event.data.__nx_ready === true) {
        clearPendingPreviewError();
        return;
      }
      if (typeof event.data.__nx_error === "string") {
        const message = event.data.__nx_error.slice(0, 800);
        clearPendingPreviewError();
        // A montagem do iframe troca bundles e CDNs. Um erro da instância antiga
        // não deve gastar créditos se a nova instância ficar saudável logo depois.
        pendingPreviewError = window.setTimeout(() => {
          pendingPreviewError = null;
          onError?.(message);
        }, 1800);
        return;
      }
      if (event.data.__ad_bridge !== true) return;
      const id = typeof event.data.id === "string" ? event.data.id.slice(0, 100) : "";
      const kind = event.data.kind as BridgeKind;
      const method = typeof event.data.method === "string" ? event.data.method.toUpperCase() : "GET";
      if (!id || !projectId || event.data.projectId !== projectId || !METHODS[kind]?.includes(method)) {
        reply(source, id, { ok: false, status: 403, error: "Operação não permitida no preview." }); return;
      }
      if (kind === "voice") {
        handleVoice(source, id, event.data.body);
        return;
      }
      const rawQs = typeof event.data.qs === "string" ? event.data.qs : "";
      const qs = rawQs.startsWith("?") && rawQs.length <= 5000 && !rawQs.includes("#") ? rawQs : "";
      const paths: Record<Exclude<BridgeKind, "voice">, string> = {
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
    return () => {
      window.removeEventListener("message", onMessage);
      clearPendingPreviewError();
      activeSpeechRequest++;
      try { activeRecognition?.abort(); } catch {}
      activeRecognition = null;
      try { window.speechSynthesis?.cancel(); } catch {}
    };
  }, [allowEditorSession, iframeRef, onError, projectId]);
}
