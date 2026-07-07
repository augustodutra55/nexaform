import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeProject, rateLimit } from "@/lib/engine/data-guard";

/**
 * Formulário de contato dos apps gerados (window.AD.email).
 * Toda submissão é SEMPRE salva na coleção "contatos" do painel de Dados
 * (funciona na hora, sem configurar nada). Se RESEND_API_KEY estiver definida,
 * também dispara um e-mail para o dono do site (EMAIL_TO ou OWNER_EMAIL).
 *
 * Segurança: o destinatário é SEMPRE o dono configurado no ambiente — nunca um
 * endereço vindo do corpo da requisição. Isso impede uso como relay de spam.
 */

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEN = 5000;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
function clip(v: any, n = MAX_LEN) {
  return typeof v === "string" ? v.slice(0, n) : "";
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

async function sendViaResend(payload: {
  name: string;
  email: string;
  subject: string;
  message: string;
  projectId: string;
}): Promise<{ emailed: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO || process.env.OWNER_EMAIL;
  if (!key || !to) return { emailed: false };
  const from = process.env.EMAIL_FROM || "AD Studio <onboarding@resend.dev>";
  const subject = payload.subject ? `Contato: ${payload.subject}` : "Nova mensagem de contato";
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 8px">Nova mensagem pelo site</h2>
      <p><strong>Nome:</strong> ${escapeHtml(payload.name) || "(não informado)"}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(payload.email) || "(não informado)"}</p>
      ${payload.subject ? `<p><strong>Assunto:</strong> ${escapeHtml(payload.subject)}</p>` : ""}
      <p><strong>Mensagem:</strong></p>
      <p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px">${escapeHtml(payload.message)}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
      <p style="color:#888;font-size:12px">Enviado pelo AD Studio · projeto ${payload.projectId}</p>
    </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        // responder direto para quem preencheu o formulário
        reply_to: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email) ? payload.email : undefined,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { emailed: false, error: `resend ${res.status}: ${t.slice(0, 200)}` };
    }
    return { emailed: true };
  } catch (e: any) {
    return { emailed: false, error: String(e?.message || e) };
  }
}

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return bad("projectId inválido");
  if (!rateLimit(`email:${projectId}`, 20)) return bad("Muitas mensagens em pouco tempo. Aguarde.", 429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const name = clip(body?.name, 200);
  const email = clip(body?.email, 200);
  const subject = clip(body?.subject, 200);
  const message = clip(body?.message);
  if (!message && !name && !email) return bad("Mensagem vazia");

  const supabase = createClient();
  const g = await authorizeProject(supabase, projectId, "write");
  if (!g.allowed) return NextResponse.json({ error: g.error }, { status: g.status });

  // 1) SEMPRE salva no painel de Dados (coleção "contatos").
  const record = { name, email, subject, message };
  const { data: row, error } = await supabase
    .from("app_data")
    .insert({ project_id: projectId, collection: "contatos", data: record })
    .select("id, data, created_at")
    .single();
  if (error) return bad(error.message, 500);

  // 2) Tenta enviar e-mail (silencioso se não configurado).
  const mail = await sendViaResend({ name, email, subject, message, projectId });

  return NextResponse.json({
    ok: true,
    saved: true,
    id: row.id,
    emailed: mail.emailed,
    // "configured" indica ao app se o e-mail está ligado; nunca vaza segredos.
    emailConfigured: !!(process.env.RESEND_API_KEY && (process.env.EMAIL_TO || process.env.OWNER_EMAIL)),
  });
}
