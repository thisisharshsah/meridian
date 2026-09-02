import * as React from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/**
 * Deterministic colour per name, so the same person keeps the same chip colour
 * across every screen without storing one.
 */
const TONES = [
  "bg-brand-subtle text-brand-subtle-foreground",
  "bg-success-subtle text-success",
  "bg-warning-subtle text-warning",
  "bg-info-subtle text-info",
  "bg-purple-subtle text-purple",
  "bg-danger-subtle text-danger",
];

function toneFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const label = name?.trim() || "Unassigned";
  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium select-none",
        { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-7 text-[11px]", lg: "size-9 text-xs" }[size],
        toneFor(label),
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}
