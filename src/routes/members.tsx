import { createFileRoute } from "@tanstack/react-router";
import { MainLayout } from "@/components/main-layout";
import { MembersView } from "@/components/members-view";

export const Route = createFileRoute("/members")({
  head: () => ({ meta: [{ title: "Members — Symphonia" }] }),
  component: () => (
    <MainLayout>
      <MembersView />
    </MainLayout>
  ),
});
