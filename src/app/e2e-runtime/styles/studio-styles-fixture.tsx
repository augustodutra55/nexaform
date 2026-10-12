"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function StudioStylesFixture() {
  const { setTheme } = useTheme();
  const [enabled, setEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card" data-testid="style-header">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-4" data-testid="style-container">
          <strong className="text-xl text-brand">AD Studio</strong>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTheme("light")}>Tema claro</Button>
            <Button variant="outline" onClick={() => setTheme("dark")}>Tema escuro</Button>
          </div>
        </div>
      </header>
      <section className="container grid gap-6 py-8 md:grid-cols-2">
        <Card data-testid="style-card">
          <CardHeader>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge>Projeto pessoal</Badge><Badge variant="success">Pronto para revisão</Badge>
            </div>
            <CardTitle>Identidade e publicação</CardTitle>
            <CardDescription>Componentes reais do Studio, sem acessar dados de pacientes ou clientes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="projeto">
              <TabsList><TabsTrigger value="projeto">Projeto</TabsTrigger><TabsTrigger value="dados">Dados</TabsTrigger></TabsList>
              <TabsContent value="projeto">
                <form className="space-y-4 pt-3" onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
                  <div className="space-y-2"><Label htmlFor="style-name">Nome do projeto</Label><Input id="style-name" data-testid="style-input" defaultValue="Clínica Beleza In Dente" required /></div>
                  <div className="space-y-2"><Label htmlFor="style-email">Contato</Label><Input id="style-email" data-testid="style-contact-input" type="email" defaultValue="equipe@example.com" required /></div>
                  <div className="flex items-center justify-between gap-3"><Label htmlFor="style-reminder">Lembretes ativos</Label><Switch id="style-reminder" checked={enabled} onCheckedChange={setEnabled} /></div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" data-testid="style-primary">Salvar projeto</Button>
                    <Button type="button" variant="outline">Exportar código</Button>
                    <Dialog><DialogTrigger asChild><Button type="button" variant="secondary">Revisar publicação</Button></DialogTrigger>
                      <DialogContent><DialogHeader><DialogTitle>Conferir entrega</DialogTitle><DialogDescription>Verifique os dados e o visual antes de publicar.</DialogDescription></DialogHeader>
                        <p className="text-sm text-muted-foreground">Esta tela de teste não publica nem altera aplicativos reais.</p>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {saved && <p role="status" className="text-sm text-emerald-500">Projeto de teste salvo.</p>}
                </form>
              </TabsContent>
              <TabsContent value="dados"><p className="py-4 text-sm text-muted-foreground">Nenhum registro real foi carregado.</p></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <div className="bg-brand-gradient rounded-xl p-6 text-white shadow-lg" data-testid="style-gradient">
            <h1 className="text-2xl font-bold">Ideias que viram produtos</h1>
            <p className="mt-3 text-sm">Seu construtor pessoal para criar e comercializar aplicativos.</p>
          </div>
          <Card data-testid="style-operation-card"><CardHeader><CardTitle>Operação protegida</CardTitle><CardDescription>Agenda, catálogo e mídia permanecem disponíveis.</CardDescription></CardHeader>
            <CardContent><div className="grid grid-cols-3 gap-3 text-center">
              {["Agenda", "Catálogo", "Mídia"].map((item) => <div key={item} className="rounded-lg border bg-secondary p-3 text-sm font-medium">{item}</div>)}
            </div></CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
