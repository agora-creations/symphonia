"use client";

import { MainLayout } from "@/components/main-layout";

export default function SettingsPage() {
  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Settings</span>
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Settings — coming in the next phase.
        </div>
      </div>
    </MainLayout>
  );
}
