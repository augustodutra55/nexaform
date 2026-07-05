import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidSchema } from "@/lib/engine/types";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { PublicPreview } from "./public-preview";

export const revalidate = 60;

export default async function PublicProjectPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name, schema, published")
    .eq("share_slug", params.slug)
    .eq("published", true)
    .maybeSingle();

  if (!project || !isValidSchema(project.schema)) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm text-muted-foreground">/ {project.name}</span>
        </div>
        <Button variant="brand" size="sm" asChild>
          <Link href="/cadastro">Construa o seu com o Nexaform</Link>
        </Button>
      </header>
      <main className="min-h-0 flex-1">
        <PublicPreview schema={project.schema} />
      </main>
    </div>
  );
}
