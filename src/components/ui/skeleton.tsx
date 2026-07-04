import { cn } from '@/lib/utils/cn';

// Skeleton / SkeletonList — loading placeholders (Tier 0) that replace bare spinners and the
// `…` ellipsis loading text some pages used, so a list keeps its shape while data arrives.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200 dark:bg-gray-700', className)} />;
}

export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
