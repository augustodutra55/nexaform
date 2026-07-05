"use client";

import { useState } from "react";
import { Monitor, Smartphone, FileText, Loader2 } from "lucide-react";
import { AppSchema } from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { SectionRenderer } from "./section-renderer";
import { Skeleton } from "@/components/ui/skeleton";

interface PreviewPaneProps {
  schema: AppSchema | null;
  currentPageId: string | null;
  onNavigate: (pageId: string) => void;
  selectedSectionId?: string | null;
  onSelectSection?: (id: string | null) => void;
  generating?: boolean;
  /** Modo público (rota /p/[slug]) esconde controles de edição. */
  readOnly?: boolean;
}

export function PreviewPane({
  schema,
  currentPageId,
  onNavigate,
  selectedSectionId,
  onSelectSection,
  generating,
  readOnly,
}: PreviewPaneProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const page = schema?.pages.find((p) => p.id === currentPageId) ?? schema?.pages[0] ?? null;
  const dark = schema?.theme.mode !== "light";

  return (
    <div className="flex h-full flex-col">
      {/* Barra de controle do preview */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {schema?.pages.map((p) => (
            <button
              key={p.id}
              onClick={() => onNavigate(p.id)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors",
                page?.id === p.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="h-3 w-3" />
              {p.name}
            </button>
          ))}
          {!schema && <span className="px-2 text-xs text-muted-foreground">Preview</span>}
        </div>
        <div className="flex items-center gap-1">
          {generating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-primary" />}
          <button
            onClick={() => setDevice("desktop")}
            aria-label="Modo desktop"
            className={cn(
              "rounded-md p-1.5 transition-colors",
              device === "desktop" ? "bg-secondary text-foreground" : "text-muted-foreground"
            )}
          >
            <Monitor className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDevice("mobile")}
            aria-label="Modo mobile"
            className={cn(
              "rounded-md p-1.5 transition-colors",
              device === "mobile" ? "bg-secondary text-foreground" : "text-muted-foreground"
            )}
          >
            <Smartphone className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto bg-secondary/40 p-4 scrollbar-thin" onClick={() => onSelectSection?.(null)}>
        {!schema ? (
          generating ? (
            <div className="mx-auto max-w-3xl space-y-4 rounded-xl border bg-card p-8">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-3 gap-3 pt-4">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
              <Skeleton className="h-10 w-36" />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="surface-grid flex h-24 w-32 items-center justify-center rounded-xl border opacity-80" />
              <p className="mt-5 font-medium">Seu preview aparece aqui</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Descreva no chat o que você quer construir e veja o resultado em tempo real.
              </p>
            </div>
          )
        ) : (
          <div
            className={cn(
              "mx-auto overflow-hidden rounded-xl border shadow-xl transition-all duration-300",
              device === "mobile" ? "max-w-[390px]" : "max-w-5xl"
            )}
            style={{
              background: dark ? "#0c0e14" : "#ffffff",
              color: dark ? "#f4f2ee" : "#15161c",
              borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Chrome de navegador: reforça que o preview é o produto real */}
            <div
              className="flex items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)" }}
            >
              <span className="flex gap-1.5">
                {[...Array(3)].map((_, i) => (
                  <span
                    key={i}
                    className="h-2 w-2 rounded-full"
                    style={{ background: dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)" }}
                  />
                ))}
              </span>
              <span
                className="mx-auto flex-1 truncate rounded-md px-3 py-1 text-center text-[11px]"
                style={{
                  background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  color: dark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)",
                  maxWidth: 320,
                }}
              >
                {schema.name.toLowerCase().replace(/\s+/g, "-")}.app{page?.path ?? "/"}
              </span>
              <span className="w-8" />
            </div>
            {page?.sections.map((section) => (
              <SectionRenderer
                key={section.id}
                section={section}
                ctx={{
                  theme: schema.theme,
                  compact: device === "mobile",
                  onNavigate: (path) => {
                    const target = schema.pages.find((pg) => pg.path === path);
                    if (target) onNavigate(target.id);
                  },
                  selected: !readOnly && selectedSectionId === section.id,
                  onSelect: readOnly ? undefined : () => onSelectSection?.(section.id),
                }}
              />
            ))}
            {page?.sections.length === 0 && (
              <p className="p-12 text-center text-sm opacity-60">Esta página ainda não tem seções.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
