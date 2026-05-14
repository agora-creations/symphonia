"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  Layers,
  Users,
  FolderKanban,
  Settings,
  Search,
  ScanSearch,
  Plus,
  ChevronDown,
  Hash,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { useWorkspaceInsights } from "@/components/use-workspace-insights";

const workspaceItems = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/issues", label: "Issues", icon: Layers },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/members", label: "Members", icon: Users },
  { to: "/teams", label: "Teams", icon: Hash },
  { to: "/harness", label: "Harness", icon: ScanSearch },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { insights, issues } = useWorkspaceInsights();
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <aside className="hidden lg:flex h-svh w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b">
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent transition-colors">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background text-xs font-bold">
            S
          </span>
          <span className="text-sm font-medium">Symphonia</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-0.5">
          <button className="grid h-7 w-7 place-items-center rounded-md hover:bg-sidebar-accent">
            <Search className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-7 w-7 place-items-center rounded-md hover:bg-sidebar-accent">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-5">
        <nav className="space-y-0.5">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                href={item.to}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
                >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.to === "/issues" && issues.length > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">{issues.length}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div>
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Your teams
            </span>
            <button
              type="button"
              disabled
              title="Team creation needs a real workspace write API."
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground opacity-60"
              aria-label="Add team"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-0.5">
            {insights.teams.map((team) => (
              <div
                key={team.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                aria-label={`${team.name} team`}
              >
                <span className={cn("grid h-5 w-5 place-items-center rounded bg-muted text-[10px] font-bold", team.color)}>
                  {team.key[0]}
                </span>
                <span className="flex-1 truncate text-left">{team.name}</span>
              </div>
            ))}
            {insights.teams.length === 0 && (
              <div className="rounded-md border bg-sidebar-accent/30 px-3 py-2 text-[12px] text-muted-foreground">
                Connect Linear and refresh issues to populate real teams.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t px-3 py-2.5 flex items-center justify-between gap-2">
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent transition-colors">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-sky-600 text-[10px] font-medium text-white">
            S
          </span>
          <span className="text-sm">Local operator</span>
        </button>
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          className="grid h-7 w-7 place-items-center rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </aside>
  );
}
