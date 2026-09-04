import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap border",
  {
    variants: {
      tone: {
        neutral: "bg-surface-muted text-muted-foreground border-border",
        brand: "bg-brand-subtle text-brand-subtle-foreground border-transparent",
        success: "bg-success-subtle text-success-strong border-transparent",
        warning: "bg-warning-subtle text-warning-strong border-transparent",
        danger: "bg-danger-subtle text-danger-strong border-transparent",
        info: "bg-info-subtle text-info-strong border-transparent",
        purple: "bg-purple-subtle text-purple border-transparent",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {props.children}
    </span>
  );
}

/** Maps the `tone` string the API sends with each select option to a badge tone. */
export function toneOf(tone: string | undefined): BadgeTone {
  const known: BadgeTone[] = ["neutral", "brand", "success", "warning", "danger", "info", "purple"];
  return known.includes(tone as BadgeTone) ? (tone as BadgeTone) : "neutral";
}
