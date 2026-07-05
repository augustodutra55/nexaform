"use client";

import { nanoid } from "nanoid";
import {
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  FileText,
  Plus,
  Moon,
  Sun,
} from "lucide-react";
import { AppSchema, Section } from "@/lib/engine/types";
import { useProjectStore } from "@/lib/store/project";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const SWATCHES = ["#fd7c11", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#ef4444", "#06b6d4", "#f59e0b"];
const EDITABLE_PROPS: Record<string, string> = {
  title: "Título",
  subtitle: "Subtítulo",
  badge: "Selo",
  cta: "Botão principal",
  secondaryCta: "Botão secundário",
  body: "Texto",
  brand: "Marca",
  tagline: "Slogan",
  submit: "Botão de envio",
};

const SECTION_LABEL: Record<string, string> = {
  navbar: "Navegação",
  hero: "Hero",
  features: "Recursos",
  stats: "Estatísticas",
  testimonials: "Depoimentos",
  pricing: "Preços",
  faq: "FAQ",
  cta: "Chamada (CTA)",
  footer: "Rodapé",
  gallery: "Galeria",
  form: "Formulário",
  kpis: "KPIs",
  table: "Tabela",
  chart: "Gráfico",
  content: "Conteúdo",
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function EditorPanel() {
  const { schema, currentPageId, selectedSectionId, setSchema, setCurrentPage, selectSection } = useProjectStore();

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Gere a primeira versão pelo chat para desbloquear o editor.
      </div>
    );
  }

  const page = schema.pages.find((p) => p.id === currentPageId) ?? schema.pages[0];
  const selected = page?.sections.find((s) => s.id === selectedSectionId) ?? null;

  function mutate(fn: (draft: AppSchema) => void) {
    const draft = clone(schema!);
    fn(draft);
    setSchema(draft);
  }

  function moveSection(idx: number, dir: -1 | 1) {
    mutate((d) => {
      const secs = d.pages.find((p) => p.id === page!.id)!.sections;
      const target = idx + dir;
      if (target < 0 || target >= secs.length) return;
      [secs[idx], secs[target]] = [secs[target], secs[idx]];
    });
  }

  function duplicateSection(idx: number) {
    mutate((d) => {
      const secs = d.pages.find((p) => p.id === page!.id)!.sections;
      const copy: Section = { ...clone(secs[idx]), id: nanoid(8) };
      secs.splice(idx + 1, 0, copy);
    });
  }

  function removeSection(idx: number) {
    mutate((d) => {
      const secs = d.pages.find((p) => p.id === page!.id)!.sections;
      secs.splice(idx, 1);
    });
    selectSection(null);
  }

  function updateSelectedProp(key: string, value: string) {
    if (!selected) return;
    mutate((d) => {
      for (const p of d.pages) {
        const s = p.sections.find((x) => x.id === selected.id);
        if (s) {
          s.props[key] = value;
          return;
        }
      }
    });
  }

  function addPage() {
    mutate((d) => {
      const n = d.pages.length + 1;
      d.pages.push({
        id: nanoid(8),
        name: `Página ${n}`,
        path: `/pagina-${n}`,
        sections: [],
      });
    });
  }

  function renamePage(id: string, name: string) {
    mutate((d) => {
      const p = d.pages.find((x) => x.id === id);
      if (p) p.name = name;
    });
  }

  function removePage(id: string) {
    if (schema!.pages.length <= 1) return;
    mutate((d) => {
      d.pages = d.pages.filter((p) => p.id !== id);
    });
    setCurrentPage(schema!.pages.find((p) => p.id !== id)?.id ?? null);
  }

  return (
    <Tabs defaultValue="estrutura" className="flex h-full flex-col">
      <div className="border-b px-3 pt-3">
        <TabsList className="w-full">
          <TabsTrigger value="estrutura" className="flex-1">Estrutura</TabsTrigger>
          <TabsTrigger value="conteudo" className="flex-1">Conteúdo</TabsTrigger>
          <TabsTrigger value="tema" className="flex-1">Tema</TabsTrigger>
        </TabsList>
      </div>

      {/* ESTRUTURA: árvore de páginas + seções */}
      <TabsContent value="estrutura" className="mt-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Páginas</p>
          <Button variant="ghost" size="sm" onClick={addPage}>
            <Plus className="h-3.5 w-3.5" /> Página
          </Button>
        </div>
        <div className="space-y-1">
          {schema.pages.map((p) => (
            <div key={p.id}>
              <div
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  page?.id === p.id ? "bg-secondary" : "hover:bg-secondary/60"
                )}
                onClick={() => setCurrentPage(p.id)}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  className="w-full bg-transparent text-sm outline-none"
                  value={p.name}
                  onChange={(e) => renamePage(p.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                {schema.pages.length > 1 && (
                  <button
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePage(p.id);
                    }}
                    aria-label={`Excluir página ${p.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>

              {/* Seções da página ativa */}
              {page?.id === p.id && (
                <div className="ml-4 mt-1 space-y-1 border-l pl-2">
                  {p.sections.map((s, idx) => (
                    <div
                      key={s.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                        selectedSectionId === s.id ? "bg-primary/10 text-primary" : "hover:bg-secondary/60"
                      )}
                    >
                      <button className="flex-1 text-left" onClick={() => selectSection(s.id)}>
                        {SECTION_LABEL[s.type] ?? s.type}
                      </button>
                      <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => moveSection(idx, -1)} aria-label="Mover para cima" className="p-0.5">
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button onClick={() => moveSection(idx, 1)} aria-label="Mover para baixo" className="p-0.5">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <button onClick={() => duplicateSection(idx)} aria-label="Duplicar" className="p-0.5">
                          <Copy className="h-3 w-3" />
                        </button>
                        <button onClick={() => removeSection(idx)} aria-label="Remover" className="p-0.5">
                          <Trash2 className="h-3 w-3 hover:text-destructive" />
                        </button>
                      </span>
                    </div>
                  ))}
                  {p.sections.length === 0 && (
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">
                      Sem seções — peça no chat para preencher esta página.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </TabsContent>

      {/* CONTEÚDO: edição de textos da seção selecionada */}
      <TabsContent value="conteudo" className="mt-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        {!selected ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            Clique em uma seção no preview (ou na aba Estrutura) para editar os textos.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">
              Editando: {SECTION_LABEL[selected.type] ?? selected.type}
            </p>
            {Object.entries(EDITABLE_PROPS)
              .filter(([key]) => typeof selected.props[key] === "string")
              .map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-xs">{label}</Label>
                  {key === "body" || String(selected.props[key]).length > 60 ? (
                    <Textarea
                      value={selected.props[key]}
                      rows={3}
                      onChange={(e) => updateSelectedProp(key, e.target.value)}
                    />
                  ) : (
                    <Input value={selected.props[key]} onChange={(e) => updateSelectedProp(key, e.target.value)} />
                  )}
                </div>
              ))}
            {Object.keys(EDITABLE_PROPS).every((k) => typeof selected.props[k] !== "string") && (
              <p className="text-xs text-muted-foreground">
                Esta seção tem conteúdo estruturado (listas). Peça alterações pelo chat — ex.: “troque o segundo
                depoimento”.
              </p>
            )}
          </div>
        )}
      </TabsContent>

      {/* TEMA */}
      <TabsContent value="tema" className="mt-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs">Modo</Label>
            <div className="flex gap-2">
              {(["dark", "light"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => mutate((d) => void (d.theme.mode = mode))}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md border py-2 text-xs transition-colors",
                    schema.theme.mode === mode ? "border-primary text-primary" : "text-muted-foreground"
                  )}
                >
                  {mode === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  {mode === "dark" ? "Escuro" : "Claro"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Cor primária</Label>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => mutate((d) => void (d.theme.primary = c))}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    schema.theme.primary === c ? "border-foreground" : "border-transparent"
                  )}
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
            <Input
              value={schema.theme.primary}
              onChange={(e) => mutate((d) => void (d.theme.primary = e.target.value))}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Raio das bordas · {schema.theme.radius}px</Label>
            <input
              type="range"
              min={0}
              max={24}
              value={schema.theme.radius}
              onChange={(e) => mutate((d) => void (d.theme.radius = Number(e.target.value)))}
              className="w-full accent-[var(--accent-color)]"
              style={{ ["--accent-color" as any]: schema.theme.primary }}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Tipografia</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["sans", "serif", "mono"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => mutate((d) => void (d.theme.font = f))}
                  className={cn(
                    "rounded-md border py-2 text-xs capitalize transition-colors",
                    schema.theme.font === f ? "border-primary text-primary" : "text-muted-foreground",
                    f === "serif" && "font-serif",
                    f === "mono" && "font-mono"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
