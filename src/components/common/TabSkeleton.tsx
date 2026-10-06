import { Skeleton } from "@/components/ui/skeleton";

export function TabSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
