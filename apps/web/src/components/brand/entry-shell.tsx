import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { t } from "@suite/shared/i18n";

/**
 * The frame every screen before the workspace shares: signing in, signing up,
 * accepting an invitation, and choosing which business to open.
 *
 * Choosing a business used to be a grey page with its own layout, which made
 * the second screen of the journey look like a different product from the
 * first. Same ground, same lockup, same card — the only thing that changes is
 * what is inside it.
 *
 * `brand-subtle` is a pale tint in light and a deep one in dark, so one token
 * gives a branded field in both themes rather than a bright slab beside a
 * near-black card.
 */
export function EntryShell({
  product,
  width = "sm",
  children,
  footer,
}: {
  product: string;
  /** `md` for the chooser, which lists businesses rather than asking for a password. */
  width?: "sm" | "md";
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-brand-subtle">
      {/* A texture, not a picture: it reads as a surface at any size and costs
          nothing to load. `currentColor` keeps it in the brand ink of whichever
          theme is active. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-brand opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* `my-auto` rather than `justify-center`: it centres while the block
          fits and collapses to nothing when it does not, so a long list on a
          short window scrolls from its top instead of having its head cut off. */}
      <div className="relative flex min-h-dvh flex-col px-4">
        <div className="my-auto flex w-full flex-col items-center py-10 sm:py-14">
          <Link href="/" className="flex items-center gap-2.5 text-brand-subtle-foreground">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight">{product}</span>
          </Link>
          <p className="mt-2 max-w-sm text-center text-sm text-brand-subtle-foreground/80">
            {t("auth.pitch")}
          </p>

          <div
            className={
              "mt-7 w-full rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7 " +
              (width === "md" ? "max-w-md" : "max-w-sm")
            }
          >
            {children}
          </div>

          {footer ? <div className="mt-5">{footer}</div> : null}

          <p className="mt-6 text-xs text-brand-subtle-foreground/70">{t("auth.selfHosted")}</p>
        </div>
      </div>
    </div>
  );
}
