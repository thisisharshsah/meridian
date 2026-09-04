"use client";

import * as React from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { useAppMeta, useSession } from "@/lib/queries";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: meta, isLoading } = useAppMeta();
  const { data: session } = useSession();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop: a permanent column. Phone: the same nav as an overlay drawer,
          because 240px of a 390px screen leaves nothing for the actual work. */}
      <Sidebar modules={meta?.modules ?? []} loading={isLoading} className="hidden md:flex" />

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <Sidebar
            modules={meta?.modules ?? []}
            loading={isLoading}
            onNavigate={() => setNavOpen(false)}
            className="absolute inset-y-0 left-0 z-50 shadow-lg"
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          session={session}
          onSearch={() => setPaletteOpen(true)}
          onMenu={() => setNavOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
