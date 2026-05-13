import type { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";

export function MainLayout({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full bg-background text-foreground">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
