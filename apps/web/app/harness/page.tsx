"use client";

import { HarnessBuilder } from "@/components/harness-builder";
import { MainLayout } from "@/components/main-layout";

export default function HarnessPage() {
  return (
    <MainLayout>
      <HarnessBuilder />
    </MainLayout>
  );
}
