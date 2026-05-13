import { useMemo } from "react";
import { teams, projects, users, userRoles } from "@/data/mock";
import { AvatarStack } from "@/components/avatar-stack";
import { Plus, Hash, Users as UsersIcon, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

export function TeamsView() {
  const enriched = useMemo(
    () =>
      teams.map((t) => {
        const members = users.filter((u) => userRoles[u.id]?.teams.includes(t.key));
        const teamProjects = projects.filter((p) => p.team === t.key);
        const active = teamProjects.filter((p) => p.status === "in-progress").length;
        return { ...t, members, projects: teamProjects, active };
      }),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Teams</span>
          <span className="text-muted-foreground tabular-nums">{teams.length}</span>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[12px] hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> New team
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {enriched.map((t) => (
            <article
              key={t.id}
              className="group rounded-lg border bg-card p-4 hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-md bg-muted text-sm font-bold",
                    t.color,
                  )}
                >
                  {t.key[0]}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold truncate">{t.name}</h3>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Hash className="h-3 w-3" /> {t.key}
                  </p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Members
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">{t.members.length}</dd>
                </div>
                <div className="rounded-md bg-muted/40 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Projects
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">{t.projects.length}</dd>
                </div>
                <div className="rounded-md bg-muted/40 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Active
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">{t.active}</dd>
                </div>
              </dl>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <UsersIcon className="h-3.5 w-3.5" />
                  <AvatarStack users={t.members} max={4} size={20} />
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FolderKanban className="h-3.5 w-3.5" />
                  {t.projects.length} projects
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
