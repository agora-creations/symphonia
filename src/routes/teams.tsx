import { createFileRoute } from "@tanstack/react-router";
import { MainLayout } from "@/components/main-layout";
import { TeamsView } from "@/components/teams-view";

export const Route = createFileRoute("/teams")({
  head: () => ({ meta: [{ title: "Teams — Symphonia" }] }),
  component: () => (
    <MainLayout>
      <TeamsView />
    </MainLayout>
  ),
});
