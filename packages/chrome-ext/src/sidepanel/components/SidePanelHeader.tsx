import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export function SidePanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-1.5 bg-card px-2 py-1.5", className)} {...props} />;
}
