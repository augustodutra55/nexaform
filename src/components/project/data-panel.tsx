"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Database, Plus, Trash2, Pencil, RefreshCw, Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  [k: string]: any;
}

/**
 * Painel de Dados (CMS embutido) — o dono gerencia os registros do app aqui,
 * com segurança (fica atrás do login do AD Studio). O app gerado apenas LÊ esses
 * dados via window.AD.list('coleção'). É o alicerce do catálogo orientado a dados:
 * centenas de produtos viram registros, não código.
 */
export function DataPanel({ projectId }: { projectId: string }) {
  const [collection, setCollection] = useState("produtos");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [adding, setAdding] = useState(false);

  const base = `/api/data/${projectId}`;

  const load = useCallback(
    async (col: string) => {
      setLoading(true);
      try {
        const res = await fetch(`${base}?collection=${encodeURIComponent(col)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Falha ao carregar");
        setRows(json.items || []);
      } catch (e: any) {
        toast.error("Não foi possível carregar os dados", { description: e?.message });
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [base]
  );

  useEffect(() => {
    load(collection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function fieldsOf(row: Row) {
    return Object.keys(row).filter((k) => k !== "id" && k !== "_createdAt");
  }

  async function addRow() {
    let data: any;
    try {
      data = JSON.parse(draft || "{}");
    } catch {
      toast.error("JSON inválido", { description: "Ex.: { \"nome\": \"Escova\", \"preco\": \"sob consulta\" }" });
      return;
    }
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collection, data }),
    });
    const json = await res.json();
    if (!res.ok) return toast.error("Não foi possível salvar", { description: json?.error });
    setRows((r) => [...r, json.item]);
    setAdding(false);
    setDraft("");
    toast.success("Registro adicionado");
  }

  async function saveEdit(id: string) {
    let data: any;
    try {
      data = JSON.parse(draft || "{}");
    } catch {
      toast.error("JSON inválido");
      return;
    }
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, data }),
    });
    const json = await res.json();
    if (!res.ok) return toast.error("Não foi possível atualizar", { description: json?.error });
    setRows((r) => r.map((row) => (row.id === id ? json.item : row)));
    setEditingId(null);
    setDraft("");
    toast.success("Registro atualizado");
  }

  async function removeRow(id: string) {
    const res = await fetch(`${base}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return toast.error("Não foi possível excluir", { description: json?.error });
    }
    setRows((r) => r.filter((row) => row.id !== id));
    toast.success("Registro excluído");
  }

  function startEdit(row: Row) {
    const clean: any = { ...row };
    delete clean.id;
    delete clean._createdAt;
    setDraft(JSON.stringify(clean, null, 2));
    setEditingId(row.id);
    setAdding(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Coleção</span>
          <Input
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(collection)}
            className="h-7 w-40 text-xs"
            placeholder="ex.: produtos"
          />
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => load(collection)}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Carregar
          </Button>
        </div>
        <Button
          variant="brand"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setDraft('{\n  "nome": "",\n  "preco": "sob consulta"\n}');
          }}
        >
          <Plus className="h-3 w-3" /> Novo registro
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        {adding && (
          <div className="mb-3 rounded-lg border bg-secondary/30 p-3">
            <p className="mb-2 text-xs font-medium">Novo registro em “{collection}” (JSON)</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(false)}>
                <X className="h-3 w-3" /> Cancelar
              </Button>
              <Button variant="brand" size="sm" className="h-7 text-xs" onClick={addRow}>
                <Check className="h-3 w-3" /> Salvar
              </Button>
            </div>
          </div>
        )}

        {rows.length === 0 && !loading && !adding && (
          <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Database className="mb-2 h-6 w-6 opacity-50" />
            Nenhum registro em “{collection}”. Clique em “Novo registro” para começar.
            <span className="mt-1 text-xs">O app lê estes dados com <code>AD.list('{collection}')</code>.</span>
          </div>
        )}

        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border p-3">
              {editingId === row.id ? (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    className="w-full resize-none rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                      <X className="h-3 w-3" /> Cancelar
                    </Button>
                    <Button variant="brand" size="sm" className="h-7 text-xs" onClick={() => saveEdit(row.id)}>
                      <Check className="h-3 w-3" /> Salvar
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {fieldsOf(row).map((k) => (
                        <span key={k} className="truncate">
                          <span className="text-muted-foreground">{k}:</span>{" "}
                          <span className="font-medium">{String(row[k])}</span>
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">id: {row.id}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(row)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeRow(row.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {rows.length} registro(s) · o app publicado lê/escreve estes dados por <code>window.AD</code>.
      </div>
    </div>
  );
}
