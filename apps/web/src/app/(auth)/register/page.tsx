"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldRow, FormError } from "@/components/form/field";
import { submitSession } from "@/lib/auth-client";
import { CURRENCIES } from "@/lib/constants";

const schema = z.object({
  name: z.string().min(1, "Your name is required"),
  // Optional in the schema; required only on the "starting a business" path,
  // checked below. Someone joining a business does not have one to name.
  organization: z.string().optional(),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
  currency: z.string().min(3),
});

type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", organization: "", email: "", password: "", currency: "USD" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (starting && !values.organization?.trim()) {
      form.setError("organization", { message: "Give the business a name" });
      return;
    }
    // Joining sends no business at all, which is what tells the server this is
    // an account on its own. Sending an empty string would be a named business
    // with a blank name, and is rejected.
    const payload = starting
      ? values
      : { name: values.name, email: values.email, password: values.password };
    const result = await submitSession("register", payload);
    if (!result.ok) {
      for (const [field, message] of Object.entries(result.fields)) {
        form.setError(field as keyof Values, { message });
      }
      if (!Object.keys(result.fields).length) setFormError(result.message);
      return;
    }
    router.replace("/");
    router.refresh();
  });

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Create your account</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {starting
          ? "You will own this business, with full access to everything in it."
          : "Sign up, then accept the invitation waiting for your email address."}
      </p>

      <div
        role="radiogroup"
        aria-label="What are you here to do?"
        className="mt-4 grid grid-cols-2 gap-2"
      >
        {[
          { on: true, label: "I'm starting a business", hint: "Set it up now" },
          { on: false, label: "I was invited", hint: "Join someone else's" },
        ].map((opt) => (
          <button
            key={String(opt.on)}
            type="button"
            role="radio"
            aria-checked={starting === opt.on}
            onClick={() => setStarting(opt.on)}
            className={
              "rounded-md border p-2.5 text-left transition-colors " +
              (starting === opt.on
                ? "border-brand bg-brand-subtle"
                : "border-border hover:bg-surface-hover")
            }
          >
            <span className="block text-sm font-medium">{opt.label}</span>
            <span className="block text-xs text-muted-foreground">{opt.hint}</span>
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />

        <FieldRow label="Your name" error={form.formState.errors.name?.message} htmlFor="name" required>
          <Input id="name" autoFocus placeholder="Ada Lovelace" aria-invalid={!!form.formState.errors.name}
            aria-describedby={form.formState.errors.name ? "name-error" : undefined} {...form.register("name")} />
        </FieldRow>

        {starting && (
          <FieldRow
            label="Business name"
            error={form.formState.errors.organization?.message}
            htmlFor="organization"
            required
          >
            <Input
              id="organization"
              placeholder="Rivera Plumbing"
              aria-invalid={!!form.formState.errors.organization}
              aria-describedby={form.formState.errors.organization ? "organization-error" : undefined}
              {...form.register("organization")}
            />
          </FieldRow>
        )}

        <div className={starting ? "grid grid-cols-[1fr_7rem] gap-3" : ""}>
          <FieldRow label="Work email" error={form.formState.errors.email?.message} htmlFor="email" required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-invalid={!!form.formState.errors.email}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
              {...form.register("email")}
            />
          </FieldRow>

          {starting && (
          <FieldRow label="Currency" htmlFor="currency">
            <Select
              value={form.watch("currency")}
              onValueChange={(v) => form.setValue("currency", v, { shouldDirty: true })}
            >
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          )}
        </div>

        <FieldRow
          label="Password"
          error={form.formState.errors.password?.message}
          htmlFor="password"
          hint="At least 8 characters."
          required
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="••••••••"
            aria-invalid={!!form.formState.errors.password}
            aria-describedby={form.formState.errors.password ? "password-error" : "password-hint"}
            {...form.register("password")}
          />
        </FieldRow>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Create workspace
          {!form.formState.isSubmitting && <ArrowRight />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
