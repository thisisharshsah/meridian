import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FieldRow({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  // role="alert" so a screen reader announces the problem when it appears
  // rather than only when the field is next visited.
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-danger">
          <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-subtle-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger"
    >
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
