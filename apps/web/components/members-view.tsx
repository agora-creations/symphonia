import { useMemo, useState } from "react";
import { users, userRoles, type Role } from "@/data/mock";
import { UserAvatar } from "@/components/avatar-stack";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_STYLE: Record<Role, string> = {
  Admin: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  Member: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  Guest: "bg-muted text-muted-foreground border-border",
};

export function MembersView() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "all">("all");

  const list = useMemo(() => {
    return users
      .map((u) => ({ ...u, ...(userRoles[u.id] ?? { role: "Member" as Role, teams: [], joined: "" }) }))
      .filter((u) => (role === "all" || u.role === role) && u.name.toLowerCase().includes(q.toLowerCase()));
  }, [q, role]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Members</span>
          <span className="text-muted-foreground tabular-nums">{list.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search members"
              className="rounded-md border bg-background pl-7 pr-2 py-1 text-[12px] w-40"
            />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role | "all")}
            className="rounded-md border bg-background px-2 py-1 text-[12px]"
          >
            <option value="all">All roles</option>
            <option value="Admin">Admin</option>
            <option value="Member">Member</option>
            <option value="Guest">Guest</option>
          </select>
          <button className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[12px] hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> Invite
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="hidden md:grid grid-cols-[1fr_8rem_1fr_8rem] gap-4 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground border-b">
          <span>Name</span>
          <span>Role</span>
          <span>Teams</span>
          <span>Joined</span>
        </div>
        {list.map((u) => (
          <div
            key={u.id}
            className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_8rem_1fr_8rem] items-center gap-4 px-4 py-2.5 border-b hover:bg-muted/40"
          >
            <div className="flex items-center gap-2 min-w-0">
              <UserAvatar user={u} size={24} />
              <span className="text-sm truncate">{u.name}</span>
            </div>
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                ROLE_STYLE[u.role],
              )}
            >
              {u.role}
            </span>
            <div className="hidden md:flex items-center gap-1 flex-wrap">
              {u.teams.map((t) => (
                <span key={t} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
            <span className="hidden md:inline text-[11px] text-muted-foreground tabular-nums">
              {u.joined ? new Date(u.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
