import type { ExportFile } from "@/lib/export/vite-project";
import type { ProjectMeta } from "@/lib/studio";

export interface DeliveryChecklistItem {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  required: boolean;
}

interface DeliveryReadinessInput {
  meta: ProjectMeta;
  published: boolean;
  shareSlug: string | null;
  canExport: boolean;
  qualityRequired?: boolean;
}

export function buildDeliveryChecklist(input: DeliveryReadinessInput): DeliveryChecklistItem[] {
  const structural = input.meta.acceptance?.structural;
  const runtime = input.meta.acceptance?.runtime;
  const runtimeErrors = runtime?.issues.filter((entry) => entry.severity === "error").length ?? 0;
  const qualityRequired = input.qualityRequired !== false;
  const qualityComplete = qualityRequired ? !!structural?.valid && !!runtime && runtimeErrors === 0 : true;

  return [
    {
      id: "client",
      label: "Cliente identificado",
      detail: "Defina o nome comercial que aparecerá na entrega.",
      complete: !!input.meta.client?.trim(),
      required: true,
    },
    {
      id: "quality",
      label: qualityRequired ? "Qualidade comprovada" : "Editor visual revisado",
      detail: qualityRequired
        ? "Código e preview precisam estar aprovados sem falhas bloqueadoras."
        : "Projetos do editor visual seguem a revisão da versão publicada.",
      complete: qualityComplete,
      required: true,
    },
    {
      id: "published",
      label: "Versão publicada",
      detail: "Gere o link final e confirme a versão que o cliente receberá.",
      complete: input.published && !!input.shareSlug,
      required: true,
    },
    {
      id: "whitelabel",
      label: "Marca do cliente",
      detail: "Ative white-label para remover a marca AD Studio da página pública.",
      complete: !!input.meta.whitelabel,
      required: false,
    },
    {
      id: "export",
      label: "Código exportável",
      detail: "O plano atual permite entregar uma cópia React + Vite.",
      complete: input.canExport,
      required: false,
    },
  ];
}

export function deliveryIsReady(items: DeliveryChecklistItem[]): boolean {
  return items.filter((item) => item.required).every((item) => item.complete);
}

interface HandoffDocumentsInput {
  projectName: string;
  projectId: string;
  publicUrl: string | null;
  meta: ProjectMeta;
  checklist: DeliveryChecklistItem[];
}

function value(value: string | null | undefined, fallback = "Não informado"): string {
  return value?.trim() || fallback;
}

export function buildHandoffDocuments(input: HandoffDocumentsInput): ExportFile[] {
  const delivery = input.meta.delivery || {};
  const completed = input.checklist.filter((item) => item.complete).length;
  const deliveryDate = delivery.deliveredAt
    ? new Date(delivery.deliveredAt).toLocaleString("pt-BR")
    : "Ainda não marcada como entregue";

  const readme = `# Entrega — ${input.projectName}

Cliente: ${value(input.meta.client)}
Projeto AD Studio: ${input.projectId}
Link publicado: ${value(input.publicUrl)}
Domínio desejado: ${value(delivery.customDomain)}
Contato do cliente: ${value(delivery.contactEmail)}
Status da entrega: ${deliveryDate}

## Conteúdo do pacote

- \`app/\`: projeto React + Vite pronto para instalar e publicar, quando aplicável;
- \`identidade.json\`: dados de marca e contato;
- \`CHECKLIST.md\`: evidências verificadas antes da entrega;
- \`NOTAS.md\`: instruções e observações do projeto.

## Publicação

O link do AD Studio continua sendo a versão administrável. Um domínio personalizado só estará ativo depois de ser adicionado ao provedor de hospedagem e de o DNS ser configurado. Informar o domínio neste pacote não altera DNS automaticamente.

## Suporte

Para continuar editando pelo AD Studio, preserve o projeto original. A exportação é uma cópia independente e não substitui o histórico do estúdio.
`;

  const checklist = `# Checklist de entrega

Resultado: ${completed}/${input.checklist.length} itens concluídos

${input.checklist.map((item) =>
    `- [${item.complete ? "x" : " "}] ${item.label}${item.required ? " (obrigatório)" : ""} — ${item.detail}`
  ).join("\n")}
`;

  const notes = `# Notas do projeto

${value(delivery.handoffNotes || input.meta.notes, "Nenhuma observação adicional.")}
`;

  return [
    { path: "ENTREGA.md", content: readme },
    { path: "CHECKLIST.md", content: checklist },
    { path: "NOTAS.md", content: notes },
    {
      path: "identidade.json",
      content: JSON.stringify({
        projectName: input.projectName,
        client: input.meta.client || null,
        whiteLabel: !!input.meta.whitelabel,
        logoUrl: delivery.logoUrl || null,
        primaryColor: delivery.primaryColor || null,
        contactEmail: delivery.contactEmail || null,
        customDomain: delivery.customDomain || null,
        publicUrl: input.publicUrl,
        deliveredAt: delivery.deliveredAt || null,
      }, null, 2) + "\n",
    },
    {
      path: "qualidade.json",
      content: JSON.stringify(input.meta.acceptance || null, null, 2) + "\n",
    },
  ];
}
