"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Issue } from "@symphonia/types";
import { getIssues, refreshIssues } from "@/lib/api";
import { buildWorkspaceInsights } from "@/lib/workspace-insights";

export function useWorkspaceInsights() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIssues(await getIssues());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load synced Linear data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setIssues(await refreshIssues());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh Linear data.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const insights = useMemo(() => buildWorkspaceInsights(issues), [issues]);

  return {
    issues,
    insights,
    loading,
    refreshing,
    error,
    reload: load,
    refresh,
  };
}
