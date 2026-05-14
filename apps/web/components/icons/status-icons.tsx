import type { Priority } from "@/lib/view-models";
import { cn } from "@/lib/utils";

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const base = "inline-block shrink-0 h-3.5 w-3.5";
  if (priority === "no-priority") {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-muted-foreground", className)}>
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    );
  }
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 14 14" className={cn(base, "text-red-500", className)}>
        <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor" />
        <rect x="6.4" y="3" width="1.2" height="5" fill="white" />
        <rect x="6.4" y="9.4" width="1.2" height="1.6" fill="white" />
      </svg>
    );
  }
  // bar charts for low/medium/high
  const heights = priority === "high" ? [4, 7, 10] : priority === "medium" ? [4, 7, 7] : [4, 4, 4];
  const opacities = priority === "high" ? [1, 1, 1] : priority === "medium" ? [1, 1, 0.35] : [1, 0.35, 0.35];
  return (
    <svg viewBox="0 0 14 14" className={cn(base, "text-foreground", className)}>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={2 + i * 4}
          y={12 - h}
          width="2"
          height={h}
          rx="0.5"
          fill="currentColor"
          opacity={opacities[i]}
        />
      ))}
    </svg>
  );
}
