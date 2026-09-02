import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-8.5 w-full rounded-md border border-border bg-surface px-2.5 py-1 text-sm shadow-xs transition-colors",
        "placeholder:text-subtle-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand focus-visible:border-brand",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-muted",
        "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[70px] w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm shadow-xs transition-colors",
      "placeholder:text-subtle-foreground",
      "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand focus-visible:border-brand",
      "disabled:cursor-not-allowed disabled:opacity-60",
      "aria-invalid:border-danger",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
