"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Row {
  id: string;
  [k: string]: any;
}

interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

type AccessProfile = "catalog" | "form" | "authenticated" | "private" | "custom";
interface AccessSettings {
  profile: AccessProfile;
  public_read: boolean;
  public_insert: boolean;
  public_update: boolean;
  public_delete: boolean;
  authenticated_read: boolean;
  authenticated_insert: boolean;
  authenticated_update: boolean;
  authenticated_delete: boolean;
  owner_only: boolean;
  allowed_roles: string[];
  authenticated_scope: "own" | "all";
  data_contract: {
    version: 1;
    allowUnknown: boolean;
    fields: Record<string, unknown>;
  };
}

interface BackendBlueprint {
  status: "ready" | "review";
  usesAuth: boolean;
  warnings: string[];
  collections: Array<{
    collection: string;
    profile: AccessProfile;
    confidence: "high" | "review";
    reason: string;
  }>;
}

interface BackendProvisioning {
  status: "ready" | "review";
  collections: string[];
  warnings: string[];
  updatedAt: string;
}

const PRIVATE_SETTINGS: AccessSettings = {
  profile: "private",
  public_read: false,
  public_insert: false,
  public_update: false,
  public_delete: false,
  authenticated_read: false,
  authenticated_insert: false,
  authenticated_update: false,
  authenticated_delete: false,
  owner_only: true,
  allowed_roles: [],
  authenticated_scope: "own",
  data_contract: { version: 1, allowUnknown: true, fields: {} },
};

const PROFILE_COPY: Record<AccessProfile, { label: string; description: string }> = {
  catalog: { label: "Catálogo público", description: "Visitantes visualizam; somente você cadastra, edita ou exclui." },
  form: { label: "Formulário público", description: "Visitantes enviam registros, mas nunca conseguem ler os envios." },
  authenticated: { label: "Usuários autenticados", description: "Cada usuário final acessa e altera somente os próprios registros." },
  private: { label: "Privado / administrativo", description: "Somente você pode visualizar e administrar esta coleção." },
  custom: { label: "Personalizado", description: "Escolha cada permissão manualmente. Use com cuidado." },
};

type PermissionKey =
  | "public_read"
  | "public_insert"
  | "public_update"
  | "public_delete"
  | "authenticated_read"
  | "authenticated_insert"
  | "authenticated_update"
  | "authenticated_delete"
  | "owner_only";
const CUSTOM_OPTIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: "public_read", label: "Público lê" },
  { key: "public_insert", label: "Público envia" },
  { key: "public_update", label: "Público altera" },
  { key: "public_delete", label: "Público exclui" },
  { key: "authenticated_read", label: "Usuário lê os próprios" },
  { key: "authenticated_insert", label: "Usuário cria" },
  { key: "authenticated_update", label: "Usuário altera os próprios" },
  { key: "authenticated_delete", label: "Usuário exclui os próprios" },
  { key: "owner_only", label: "Somente administrador" },
];

function settingsFor(profile: AccessProfile, current: AccessSettings): AccessSettings {
  const advanced = {
    allowed_roles: current.allowed_roles,
    authenticated_scope: current.authenticated_scope,
    data_contract: current.data_contract,
  };
  if (profile === "catalog") return { ...PRIVATE_SETTINGS, ...advanced, profile, public_read: true, owner_only: false };
  if (profile === "form") return { ...PRIVATE_SETTINGS, ...advanced, profile, public_insert: true, owner_only: false };
  if (profile === "authenticated") {
    return {
      ...PRIVATE_SETTINGS,
      ...advanced,
      profile,
      authenticated_read: true,
      authenticated_insert: true,
      authenticated_update: true,
      authenticated_delete: true,
      owner_only: false,
    };
  }
  if (profile === "private") return { ...PRIVATE_SETTINGS, ...advanced };
  return { ...PRIVATE_SETTINGS, ...advanced, profile: "custom", owner_only: false };
}

/**
 * Painel de Dados (CMS embutido) — o dono gerencia os registros do app aqui,
 * com segurança (fica atrás do login do AD Studio). O app gerado acessa os dados
 * conforme o perfil da coleção. É o alicerce do catálogo orientado a dados:
 * centenas de produtos viram registros, não código.
 */
export function DataPanel({ projectId }: { projectId: string }) {
  const [collection, setCollection] = useState("produtos");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<AccessSettings>(PRIVATE_SETTINGS);
  const [savingAccess, setSavingAccess] = useState(false);
  const [contractDraft, setContractDraft] = useState(JSON.stringify(PRIVATE_SETTINGS.data_contract, null, 2));
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [backendBlueprint, setBackendBlueprint] = useState<BackendBlueprint | null>(null);
  const [backendProvisioning, setBackendProvisioning] = useState<BackendProvisioning | null>(null);
  const [provisioningBackend, setProvisioningBackend] = useState(false);

  const base = `/api/data/${projectId}`;

  const loadBackendBlueprint = useCallback(async () => {
    try {
      const res = await fetch(`/api/backend/${projectId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao analisar o backend");
      setBackendBlueprint(json.blueprint || null);
      setBackendProvisioning(json.provisioning || null);
    } catch (error: any) {
      toast.error("Não foi possível analisar o backend", { description: error?.message });
    }
  }, [projectId]);

  async function provisionBackend() {
    setProvisioningBackend(true);
    try {
      const res = await fetch(`/api/backend/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: true, force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao configurar o backend");
      setBackendBlueprint(json.blueprint || null);
      setBackendProvisioning(json.provisioning || null);
      if (json.blueprint?.status === "review") {
        toast.warning("Backend protegido e configurado", {
          description: "Uma ou mais coleções ficaram privadas e precisam de revisão antes do uso público.",
        });
      } else {
        toast.success("Backend configurado automaticamente");
      }
    } catch (error: any) {
      toast.error("Não foi possível configurar o backend", { description: error?.message });
    } finally {
      setProvisioningBackend(false);
    }
  }

  const load = useCallback(
    async (col: string) => {
      setLoading(true);
      try {
        const [dataRes, accessRes] = await Promise.all([
          fetch(`${base}?collection=${encodeURIComponent(col)}`),
          fetch(`${base}/settings?collection=${encodeURIComponent(col)}`),
        ]);
        const [dataJson, accessJson] = await Promise.all([dataRes.json(), accessRes.json()]);
        if (!dataRes.ok) throw new Error(dataJson?.error || "Falha ao carregar");
        if (!accessRes.ok) throw new Error(accessJson?.error || "Falha ao carregar as permissões");
        setRows(dataJson.items || []);
        const nextAccess = { ...PRIVATE_SETTINGS, ...(accessJson.settings || {}) };
        setAccess(nextAccess);
        setContractDraft(JSON.stringify(nextAccess.data_contract, null, 2));
      } catch (e: any) {
        toast.error("Não foi possível carregar os dados", { description: e?.message });
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [base]
  );

  async function saveAccess() {
    let dataContract: AccessSettings["data_contract"];
    try {
      dataContract = JSON.parse(contractDraft);
    } catch {
      toast.error("Contrato de dados inválido", { description: "Revise o JSON antes de salvar." });
      return;
    }
    setSavingAccess(true);
    try {
      const res = await fetch(`${base}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collection,
          profile: access.profile,
          permissions: access.profile === "custom" ? { ...access, data_contract: dataContract } : undefined,
          allowed_roles: access.allowed_roles,
          authenticated_scope: access.authenticated_scope,
          data_contract: dataContract,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail = json?.fieldErrors ? Object.values(json.fieldErrors).join(" ") : "";
        throw new Error([json?.error || "Falha ao salvar as permissões", detail].filter(Boolean).join(" "));
      }
      setAccess(json.settings);
      setContractDraft(JSON.stringify(json.settings.data_contract, null, 2));
      if (json.advancedReady === false) {
        toast.warning("Acesso básico salvo", {
          description: "Aplique a migration 0012 no Supabase para ativar papéis e contratos.",
        });
      } else {
        toast.success("Acesso da coleção atualizado");
      }
    } catch (e: any) {
      toast.error("Não foi possível salvar o acesso", { description: e?.message });
    } finally {
      setSavingAccess(false);
    }
  }

  async function loadAppUsers() {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/app-auth/${projectId}/users`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao carregar usuários");
      setAppUsers(json.users || []);
    } catch (e: any) {
      toast.error("Não foi possível carregar os usuários", { description: e?.message });
    } finally {
      setLoadingUsers(false);
    }
  }

  async function updateAppUserRole(id: string, role: string) {
    const res = await fetch(`/api/app-auth/${projectId}/users`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, role: role.trim().toLowerCase() }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error("Não foi possível alterar o papel", { description: json?.error });
      return;
    }
    setAppUsers((users) => users.map((user) => (user.id === id ? json.user : user)));
    toast.success("Papel do usuário atualizado");
  }

  useEffect(() => {
    load(collection);
    loadBackendBlueprint();
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
      <div className="border-b bg-primary/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <ServerCog className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Backend automático do aplicativo</p>
            <p className="text-[11px] text-muted-foreground">
              {backendBlueprint
                ? `${backendBlueprint.collections.length} coleção(ões) detectada(s)${backendBlueprint.usesAuth ? " · login e isolamento por usuário" : ""}.`
                : "Analisando coleções, validações e acesso do código atual…"}
            </p>
          </div>
          {backendProvisioning && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-[10px]">
              {backendProvisioning.status === "ready" ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              )}
              Configurado
            </span>
          )}
          <Button
            variant="brand"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={provisionBackend}
            disabled={provisioningBackend || !backendBlueprint}
          >
            {provisioningBackend ? <Loader2 className="h-3 w-3 animate-spin" /> : <ServerCog className="h-3 w-3" />}
            Configurar novamente
          </Button>
        </div>
        {backendBlueprint && backendBlueprint.collections.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {backendBlueprint.collections.map((item) => (
              <span
                key={item.collection}
                title={item.reason}
                className="rounded-full border bg-background px-2 py-0.5 text-[10px]"
              >
                {item.collection} · {PROFILE_COPY[item.profile].label}
              </span>
            ))}
          </div>
        )}
        {backendBlueprint?.warnings.map((warning) => (
          <p key={warning} className="mt-1 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {warning}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Coleção</span>
          <Input
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setAccess(PRIVATE_SETTINGS);
            }}
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

      <div className="border-b bg-secondary/20 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Acesso</span>
          <select
            value={access.profile}
            onChange={(e) => setAccess((current) => settingsFor(e.target.value as AccessProfile, current))}
            className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            aria-label="Perfil de acesso da coleção"
          >
            {(Object.keys(PROFILE_COPY) as AccessProfile[]).map((profile) => (
              <option key={profile} value={profile}>{PROFILE_COPY[profile].label}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={saveAccess} disabled={savingAccess}>
            {savingAccess && <Loader2 className="h-3 w-3 animate-spin" />}
            Salvar acesso
          </Button>
          <span className="min-w-60 flex-1 text-[11px] text-muted-foreground">
            {PROFILE_COPY[access.profile].description}
          </span>
        </div>
        {access.profile === "custom" && (
          <div className="mt-2 grid gap-2 rounded-lg border bg-background/60 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {CUSTOM_OPTIONS.map((option) => (
              <label key={option.key} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={access[option.key]}
                  onChange={(e) => setAccess((current) => ({ ...current, [option.key]: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                {option.label}
              </label>
            ))}
            {(access.public_update || access.public_delete) && (
              <p className="sm:col-span-2 lg:col-span-3 text-[11px] text-destructive">
                Atenção: permitir alteração ou exclusão pública deixa qualquer visitante modificar dados.
              </p>
            )}
          </div>
        )}
        <details className="mt-2 rounded-lg border bg-background/60 p-2">
          <summary className="cursor-pointer text-[11px] font-medium">
            Regras avançadas: papéis, isolamento e contrato de dados
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label className="grid gap-1 text-[11px]">
              Papéis permitidos (separados por vírgula)
              <Input
                value={access.allowed_roles.join(", ")}
                onChange={(e) =>
                  setAccess((current) => ({
                    ...current,
                    allowed_roles: e.target.value
                      .split(",")
                      .map((role) => role.trim().toLowerCase())
                      .filter(Boolean),
                  }))
                }
                className="h-8 text-xs"
                placeholder="ex.: gerente, consultor"
              />
              <span className="text-muted-foreground">Vazio permite qualquer usuário autenticado.</span>
            </label>
            <label className="grid gap-1 text-[11px]">
              Dados de usuários autenticados
              <select
                value={access.authenticated_scope}
                onChange={(e) =>
                  setAccess((current) => ({
                    ...current,
                    authenticated_scope: e.target.value as "own" | "all",
                  }))
                }
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                <option value="own">Cada usuário vê somente os próprios</option>
                <option value="all">Papéis permitidos veem todos</option>
              </select>
              <span className="text-muted-foreground">
                Use “todos” apenas para equipes internas, como gerentes e consultores.
              </span>
            </label>
            <label className="grid gap-1 text-[11px] lg:col-span-2">
              Contrato JSON da coleção
              <textarea
                value={contractDraft}
                onChange={(e) => setContractDraft(e.target.value)}
                rows={7}
                spellCheck={false}
                className="w-full resize-y rounded-md border bg-background p-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">
                Tipos aceitos: string, number, integer, boolean, email, date, uuid, array e object.
                Defina required, minLength, maxLength, min, max, pattern ou enum.
              </span>
            </label>
            <div className="lg:col-span-2 rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium">Usuários finais e papéis</p>
                  <p className="text-[10px] text-muted-foreground">
                    O cadastro público sempre começa como “user”. Somente você pode promover uma conta.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={loadAppUsers}
                  disabled={loadingUsers}
                >
                  {loadingUsers ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Carregar usuários
                </Button>
              </div>
              {appUsers.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {appUsers.map((user) => (
                    <div key={user.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium">{user.name || user.email}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
                      </div>
                      <Input
                        defaultValue={user.role}
                        aria-label={`Papel de ${user.email}`}
                        className="h-7 w-28 text-[11px]"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            updateAppUserRole(user.id, event.currentTarget.value);
                          }
                        }}
                        onBlur={(event) => {
                          if (event.currentTarget.value !== user.role) {
                            updateAppUserRole(user.id, event.currentTarget.value);
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>
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
        {rows.length} registro(s) · acesso: {PROFILE_COPY[access.profile].label.toLowerCase()}.
      </div>
    </div>
  );
}
