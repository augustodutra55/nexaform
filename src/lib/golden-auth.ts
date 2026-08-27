import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOwner } from "@/lib/access";

const MAX_SKEW_MS = 5 * 60_000;

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function verifyGoldenServiceHeaders(headers: Headers): boolean {
  const secret = process.env.AD_GOLDEN_SERVICE_SECRET;
  if (!secret) return false;

  const timestamp = headers.get("x-ad-golden-timestamp") || "";
  const signature = headers.get("x-ad-golden-signature") || "";
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;

  const expected = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");
  return safeEqual(signature, expected);
}

export function verifyGoldenServiceAuth(request: Request): boolean {
  return verifyGoldenServiceHeaders(request.headers);
}

/**
 * O Golden pode exercer um projeto privado do owner sem uma sessão do editor.
 * A assinatura HMAC fica somente no runner e o bypass continua limitado a
 * projetos pertencentes à conta administrativa.
 */
export async function verifyGoldenOwnerProject(
  request: Request,
  projectId: string,
  admin: SupabaseClient
): Promise<boolean> {
  if (!verifyGoldenServiceAuth(request)) return false;
  const { data: project } = await admin
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.user_id) return false;
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(project.user_id),
    admin.from("profiles").select("role").eq("id", project.user_id).maybeSingle(),
  ]);
  return isOwner({ email: authUser?.user?.email, role: profile?.role });
}
