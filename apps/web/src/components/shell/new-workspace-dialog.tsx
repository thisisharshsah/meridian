"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldRow, FormError } from "@/components/form/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/lib/i18n";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "AED", "JPY"];

/**
 * Start a second business under the same login.
 *
 * Deliberately not the sign-up form: the person already has an account, so the
 * only things still unknown are what the business is called and what it charges
 * in. Everything else -- roles, numbering, ownership -- the server sets up.
 */
export function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setCurrency("USD");
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError(t("workspace.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization: name.trim(), currency }),
      });
      if (!res.ok) throw new Error();
      // The reply carries a session for the new workspace, so everything held
      // for the old one is now the wrong company's data.
      qc.clear();
      onOpenChange(false);
      toast.success(t("workspace.created", undefined, { name: name.trim() }));
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("workspace.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("workspace.create")}</DialogTitle>
            <DialogDescription>{t("workspace.createLede")}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />
            <FieldRow label={t("workspace.name")} htmlFor="ws-name" required>
              <Input
                id="ws-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rivera Plumbing"
              />
            </FieldRow>
            <FieldRow label={t("workspace.currency")} htmlFor="ws-currency" hint={t("workspace.currencyHint")}>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="ws-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              {t("workspace.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
