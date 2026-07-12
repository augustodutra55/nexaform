"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Login com Google (Supabase Auth, fluxo OAuth + PKCE).
 *
 * O botão apenas inicia o fluxo — a autenticação continua acontecendo no
 * Supabase/Google. O código volta para /auth/callback, que troca o code por
 * sessão (cookies httpOnly). O bypass de owner só é aplicado DEPOIS disso,
 * pela mesma lógica de sempre (access.ts): nada de acesso anônimo ou por URL.
 */
export function GoogleButton({ next = "/dashboard", label = "Continuar com Google" }: { next?: string; label?: string }) {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    const safeNext = safeNextPath(next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
        // refresh token de longa duração para manter a sessão persistente
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setLoading(false);
      toast.error("Não foi possível entrar com o Google", { description: error.message });
    }
    // Em caso de sucesso o navegador é redirecionado ao Google — sem reset de loading.
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={signIn} disabled={loading}>
      {loading ? (
        <Loader2 className="animate-spin" />
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
          />
        </svg>
      )}
      {label}
    </Button>
  );
}
