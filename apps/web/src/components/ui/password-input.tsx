"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field with a reveal toggle. Typing a password blind is the usual
 * cause of a "wrong password" that was in fact typed correctly the first time,
 * and it is worst on phones, where autocorrect and a cramped keyboard make a
 * silent typo likely.
 *
 * The button is type="button" so it never submits the form, and it stays in the
 * tab order because a keyboard user needs the reveal as much as anyone.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className={cn(
          "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md",
          "text-subtle-foreground transition-colors hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand",
        )}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
