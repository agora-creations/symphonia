export type Priority = "no-priority" | "urgent" | "high" | "medium" | "low";

export const PRIORITY_LABELS: Record<Priority, string> = {
  "no-priority": "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export type IssueStatus = "backlog" | "todo" | "in-progress" | "in-review" | "done" | "cancelled";

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
}
