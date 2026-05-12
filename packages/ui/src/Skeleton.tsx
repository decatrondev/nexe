// ── Skeleton Loaders ───────────────────────────────────
// Animated placeholder elements for loading states.

interface SkeletonProps {
  className?: string;
}

/** Generic rectangular skeleton block */
function Skeleton({ className = "h-4 w-full" }: SkeletonProps) {
  return (
    <div className={`animate-pulse rounded bg-dark-700 ${className}`} />
  );
}

/** Skeleton that mimics a chat message row */
function SkeletonMessage({ className = "" }: SkeletonProps) {
  return (
    <div className={`flex items-start gap-3 px-4 py-2 ${className}`}>
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </div>
  );
}

/** Skeleton that mimics a user/member row */
function SkeletonUser({ className = "" }: SkeletonProps) {
  return (
    <div className={`flex items-center gap-2.5 px-3 py-1.5 ${className}`}>
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <Skeleton className="h-3.5 w-20" />
    </div>
  );
}

/** Skeleton that mimics a channel row */
function SkeletonChannel({ className = "" }: SkeletonProps) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 ${className}`}>
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
      <Skeleton className="h-3.5 w-24" />
    </div>
  );
}

export { Skeleton, SkeletonMessage, SkeletonUser, SkeletonChannel };
export type { SkeletonProps };
