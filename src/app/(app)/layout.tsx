import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app/header";
import { isOwner } from "@/lib/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader email={user.email ?? ""} name={(user.user_metadata?.full_name as string) ?? ""} owner={owner} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
