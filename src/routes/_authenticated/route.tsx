import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { RoutineScheduleMaintainer } from "@/components/RoutineScheduleMaintainer";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { next: undefined } });
    }
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <RoutineScheduleMaintainer />
      <Outlet />
    </AppShell>
  ),
});
