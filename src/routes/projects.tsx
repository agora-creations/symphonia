import { createFileRoute } from "@tanstack/react-router";
import { MainLayout } from "@/components/main-layout";
import { ProjectsView } from "@/components/projects-view";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Symphonia" },
      { name: "description", content: "Track projects across teams." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  return (
    <MainLayout>
      <ProjectsView />
    </MainLayout>
  );
}
