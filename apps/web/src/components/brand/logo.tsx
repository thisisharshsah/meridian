import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/** Four quadrants for the four sides of a business: sell, bill, deliver, support. */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path d="M8.5 21.5V10.5L16 17.5L23.5 10.5V21.5" stroke="currentColor" className="text-brand-foreground" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo size={24} />
      <span className="text-[15px] font-semibold tracking-tight">{t("app.name")}</span>
    </span>
  );
}
