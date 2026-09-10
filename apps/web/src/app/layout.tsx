import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { t } from "@/lib/i18n";

export const metadata: Metadata = {
  title: {
    default: t("app.name"),
    template: t("app.titleTemplate", undefined, { app: t("app.name") }),
  },
  description: t("app.tagline"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181b21" },
  ],
};

/**
 * Theme is applied before first paint so a dark-mode reload never flashes
 * white. Reading localStorage can throw in locked-down browsers, hence the
 * try/catch.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('suite-theme');
  var dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
  // Sidebar width has to be right in the first paint too. React only learns the
  // stored choice after mount, so without this a collapsed sidebar renders at
  // full width and snaps narrow on every single page load.
  if (localStorage.getItem('suite-sidebar-collapsed') === '1') {
    document.documentElement.classList.add('nav-collapsed');
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
