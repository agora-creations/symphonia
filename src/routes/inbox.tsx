import { createFileRoute } from "@tanstack/react-router";
import { MainLayout } from "@/components/main-layout";

export const Route = createFileRoute("/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Symphonia" }] }),
  component: () => (
    <MainLayout>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Inbox</span>
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Inbox — coming in the next phase.
        </div>
      </div>
    </MainLayout>
  ),
});
