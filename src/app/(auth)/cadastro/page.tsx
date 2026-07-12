"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/auth/google-button";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) {
      toast.error("Senha muito curta", { description: "Use pelo menos 8 caracteres." });
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const email = String(form.get("email"));
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: String(form.get("name")) },
        emailRedirectTo: `${location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível criar a conta", { description: error.message });
      return;
    }

    // Confirmação desativada: a sessão já existe e o onboarding pode abrir.
    if (data.session) {
      toast.success("Conta criada!", { description: "Vamos configurar seu espaço." });
      router.push("/onboarding");
      router.refresh();
      return;
    }

    // Confirmação ativada: permanece nesta página até o usuário validar o link.
    setConfirmationEmail(email);
    toast.success("Verifique seu e-mail", {
      description: "Se for uma nova conta, enviaremos o link de ativação. Se já tiver cadastro, faça login.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crie sua conta</CardTitle>
        <CardDescription>Seu primeiro produto fica de pé hoje. Sem cartão de crédito.</CardDescription>
      </CardHeader>
      <CardContent>
        {confirmationEmail ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
            <MailCheck className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">Confirme seu e-mail para continuar</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Se este for um novo cadastro, enviaremos um link para{" "}
              <strong className="text-foreground">{confirmationEmail}</strong>. Abra seu e-mail e clique no link
              para ativar a conta. Se você já tinha cadastro, entre normalmente.
            </p>
            <Button variant="outline" className="mt-5" asChild>
              <Link href="/login">Ir para o login</Link>
            </Button>
          </div>
        ) : (
          <>
            <GoogleButton next="/onboarding" label="Cadastrar com Google" />
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              ou com email
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" name="name" placeholder="Como devemos te chamar?" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="voce@email.com" required autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" name="password" type="password" placeholder="Mínimo de 8 caracteres" required autoComplete="new-password" />
              </div>
              <Button type="submit" className="w-full" variant="brand" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                Criar conta
              </Button>
            </form>
          </>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
