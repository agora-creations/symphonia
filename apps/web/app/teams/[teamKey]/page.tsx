import { MainLayout } from "@/components/main-layout";
import { TeamDetailView } from "@/components/team-detail-view";

export default async function TeamPage({ params }: { params: Promise<{ teamKey: string }> }) {
  const { teamKey } = await params;
  return (
    <MainLayout>
      <TeamDetailView teamKey={teamKey} />
    </MainLayout>
  );
}
