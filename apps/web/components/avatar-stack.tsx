import type { User } from "@/lib/view-models";
import { cn } from "@/lib/utils";

export function UserAvatar({ user, className, size = 20 }: { user: User; className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-background",
        user.color,
        className,
      )}
      style={{ width: size, height: size }}
      title={user.name}
    >
      {user.initials}
    </span>
  );
}

export function AvatarStack({ users, max = 3, size = 20 }: { users: User[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((u) => (
        <UserAvatar key={u.id} user={u} size={size} />
      ))}
      {extra > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background"
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
