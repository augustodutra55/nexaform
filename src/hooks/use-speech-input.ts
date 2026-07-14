"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SpeechInputOptions {
  value: string;
  onChange: (value: string) => void;
  lang?: string;
}

function constructor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function errorMessage(code: string): { title: string; description?: string } | null {
  if (code === "aborted") return null;
  if (code === "not-allowed" || code === "service-not-allowed") {
    return {
      title: "Permissão do microfone bloqueada",
      description: "Clique no cadeado ao lado do endereço, permita o Microfone e recarregue a página.",
    };
  }
  if (code === "audio-capture") return { title: "Microfone indisponível", description: "Confira se outro aplicativo está usando o microfone." };
  if (code === "no-speech") return { title: "Não ouvi sua voz", description: "Tente novamente falando mais perto do microfone." };
  if (code === "network") return { title: "O serviço de voz ficou indisponível", description: "Confira a conexão e tente novamente." };
  return { title: "Não foi possível usar o microfone", description: code || "Tente novamente." };
}

export function useSpeechInput({ value, onChange, lang = "pt-BR" }: SpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const recognitionRef = useRef<any>(null);
  const valueRef = useRef(value);
  const changeRef = useRef(onChange);
  valueRef.current = value;
  changeRef.current = onChange;

  useEffect(() => {
    setSupported(!!constructor());
    return () => {
      try { recognitionRef.current?.abort(); } catch {}
      recognitionRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      try { recognitionRef.current?.stop(); } catch {}
      return;
    }
    if (!window.isSecureContext) {
      toast.error("O microfone exige uma conexão segura (HTTPS).");
      return;
    }
    const Recognition = constructor();
    if (!Recognition) {
      toast.error("Ditado não disponível neste navegador", { description: "Use Chrome ou Edge atualizado e permita o microfone." });
      return;
    }

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = valueRef.current.trim();
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index++) transcript += event.results[index][0]?.transcript || "";
      changeRef.current(`${base}${base && transcript ? " " : ""}${transcript}`);
    };
    recognition.onerror = (event: any) => {
      setListening(false);
      const message = errorMessage(String(event?.error || ""));
      if (message) toast.error(message.title, { description: message.description });
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setListening(false);
      toast.error("Não foi possível iniciar o microfone", { description: error instanceof Error ? error.message : undefined });
    }
  }, [lang, listening]);

  return { listening, supported, toggle };
}
