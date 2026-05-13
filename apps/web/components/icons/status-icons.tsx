import type { ProjectStatus, Priority, Health } from "@/data/mock";
import { cn } from "@/lib/utils";

export function StatusIcon({ status, className }: { status: ProjectStatus; className?: string }) {
  const base = "inline-block shrink-0";
  switch (status) {
    case "backlog":
      return (
        <svg viewBox="0 0 14 14" className={cn(base, "h-3.5 w-3.5 text-muted-foreground", className)}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
      );
    case "planned":
      return (
        <svg viewBox="0 0 14 14" className={cn(base, "h-3.5 w-3.5 text-muted-foreground", className)}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "in-progress":
      return (
        <svg viewBox="0 0 14 14" className={cn(base, "h-3.5 w-3.5 text-amber-500", className)}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 7 L7 2 A5 5 0 0 1 12 7 Z" fill="currentColor" />
        </svg>
      );
    case "paused":
      return (
        <svg viewBox="0 0 14 14" className={cn(base, "h-3.5 w-3.5 text-orange-500", className)}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="5" y="4.5" width="1.5" height="5" fill="currentColor" />
          <rect x="7.5" y="4.5" width="1.5" height="5" fill="currentColor" />
        </svg>
      );
    case "completed":
      return (
        <svg viewBox="0 0 14 14" className={cn(base, "h-3.5 w-3.5 text-emerald-500", className)}>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.2 7.2 L6.2 9 L9.8 5.2" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "cancelled":
      return (
        <svg viewBox="0 0 14 14" className={cn(base, "h-3.5 w-3.5 text-muted-foreground", className)}>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.5 4.5 L9.5 9.5 M9.5 4.5 L4.5 9.5" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

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

export function HealthDot({ health, className }: { health: Health; className?: string }) {
  const color =
    health === "on-track"
      ? "bg-emerald-500"
      : health === "at-risk"
        ? "bg-amber-500"
        : health === "off-track"
          ? "bg-red-500"
          : "bg-muted-foreground/40";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color, className)} />;
}

export function ProgressRing({ value, className }: { value: number; className?: string }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3.5 w-3.5 -rotate-90 text-primary", className)}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  );
}
