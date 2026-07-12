import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader email={user.email ?? ""} name={(user.user_metadata?.full_name as string) ?? ""} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
