import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGoldenServiceHeaders } from "@/lib/golden-auth";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createClient() {
  const requestHeaders = await headers();
  if (verifyGoldenServiceHeaders(requestHeaders)) {
    const admin = createAdminClient();
    if (!admin) throw new Error("Golden service auth requer SUPABASE_SERVICE_ROLE_KEY no servidor.");

    const ownerEmail = String(process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || "")
      .trim()
      .toLowerCase();
    if (!ownerEmail) throw new Error("Golden service auth requer OWNER_EMAIL no servidor.");

    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(`Golden service auth não conseguiu localizar o owner: ${error.message}`);
    const ownerUser = data.users.find((user) => String(user.email || "").toLowerCase() === ownerEmail);
    if (!ownerUser) throw new Error("Golden service auth não encontrou o usuário owner configurado.");

    const originalGetUser = admin.auth.getUser.bind(admin.auth);
    admin.auth.getUser = (async (...args: Parameters<typeof originalGetUser>) => {
      if (args.length > 0) return originalGetUser(...args);
      return { data: { user: ownerUser }, error: null } as Awaited<ReturnType<typeof originalGetUser>>;
    }) as typeof admin.auth.getUser;

    return admin;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Chamado a partir de um Server Component — pode ignorar
            // se houver middleware renovando a sessão.
          }
        },
      },
    }
  );
}
