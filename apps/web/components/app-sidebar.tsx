import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  Layers,
  Users,
  FolderKanban,
  Settings,
  Search,
  Plus,
  ChevronDown,
  Hash,
  Moon,
  Sun,
} from "lucide-react";
import { teams } from "@/data/mock";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

const workspaceItems = [
  { to: "/inbox", label: "Inbox", icon: Inbox, count: 3 },
  { to: "/issues", label: "Issues", icon: Layers },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/members", label: "Members", icon: Users },
  { to: "/teams", label: "Teams", icon: Hash },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <aside className="hidden lg:flex h-svh w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b">
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent transition-colors">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background text-xs font-bold">
            C
          </span>
          <span className="text-sm font-medium">Circle</span>
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
                {item.count != null && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Your teams
            </span>
            <button className="grid h-5 w-5 place-items-center rounded hover:bg-sidebar-accent">
              <Plus className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
          <div className="space-y-0.5">
            {teams.map((t) => (
              <button
                key={t.id}
                className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
              >
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded text-[10px] font-bold bg-muted",
                    t.color,
                  )}
                >
                  {t.key[0]}
                </span>
                <span className="flex-1 text-left">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t px-3 py-2.5 flex items-center justify-between gap-2">
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent transition-colors">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-rose-500 text-[10px] font-medium text-white">
            AM
          </span>
          <span className="text-sm">Ava Martinez</span>
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
