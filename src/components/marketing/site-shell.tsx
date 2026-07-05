import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/brand/logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/#como-funciona" className="transition-colors hover:text-foreground">Como funciona</Link>
          <Link href="/#recursos" className="transition-colors hover:text-foreground">Recursos</Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">Preços</Link>
          <Link href="/#faq" className="transition-colors hover:text-foreground">FAQ</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Entrar</Link>
          </Button>
          <Button variant="brand" asChild>
            <Link href="/cadastro">Começar a construir</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-12">
      <div className="container grid gap-10 md:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm text-muted-foreground">
            Do prompt ao produto.
          </p>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Nexaform. Todos os direitos reservados.</p>
        </div>
        {[
          { title: "Produto", links: [["Como funciona", "/#como-funciona"], ["Recursos", "/#recursos"], ["Preços", "/pricing"], ["Exemplos", "/#exemplos"]] },
          { title: "Empresa", links: [["Sobre", "#"], ["Blog", "#"], ["Carreiras", "#"], ["Contato", "#"]] },
          { title: "Legal", links: [["Privacidade", "#"], ["Termos de uso", "#"], ["Cookies", "#"]] },
        ].map((col) => (
          <div key={col.title} className="space-y-3">
            <p className="text-sm font-medium">{col.title}</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="transition-colors hover:text-foreground">{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}

export { LogoMark };
