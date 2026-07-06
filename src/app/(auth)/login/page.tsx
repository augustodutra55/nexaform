"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/auth/google-button";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [email, setEmail] = useState("");
  const next = searchParams.get("next") ?? "/dashboard";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível entrar", {
        description: "Confira email e senha e tente novamente.",
      });
      return;
    }
    router.push(next);
    router.refresh();
  }

  // Link mágico: entra sem senha — recebe um link por email e clica.
  async function sendMagicLink() {
    if (!email.trim()) {
      toast.error("Informe seu email", { description: "Digite o email para receber o link de acesso." });
      return;
    }
    setMagicLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setMagicLoading(false);
    if (error) {
      toast.error("Não foi possível enviar o link", { description: error.message });
      return;
    }
    toast.success("Link enviado!", { description: `Abra o email em ${email.trim()} e clique no link para entrar.` });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bem-vindo de volta</CardTitle>
        <CardDescription>Seus projetos estão exatamente onde você os deixou.</CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleButton next={next} />
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou com email
          <span className="h-px flex-1 bg-border" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="voce@email.com"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Senha</Label>
              <Link href="/recuperar-senha" className="text-xs text-primary underline-offset-4 hover:underline">
                Esqueci a senha
              </Link>
            </div>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full" variant="brand" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Entrar
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          className="mt-2 w-full text-sm"
          onClick={sendMagicLink}
          disabled={magicLoading}
        >
          {magicLoading && <Loader2 className="animate-spin" />}
          Entrar sem senha (link por email)
        </Button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="text-primary underline-offset-4 hover:underline">
            Criar grátis
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
