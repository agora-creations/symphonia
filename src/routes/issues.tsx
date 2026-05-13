import { createFileRoute } from "@tanstack/react-router";
import { MainLayout } from "@/components/main-layout";
import { IssuesView } from "@/components/issues-view";

export const Route = createFileRoute("/issues")({
  head: () => ({ meta: [{ title: "Issues — Symphonia" }] }),
  component: () => (
    <MainLayout>
      <IssuesView />
    </MainLayout>
  ),
});
