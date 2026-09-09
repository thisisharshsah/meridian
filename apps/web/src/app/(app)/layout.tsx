"use client";

import * as React from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ChooseWorkspace } from "@/components/shell/choose-workspace";
import { BottomNav } from "@/components/shell/bottom-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { useAppMeta, useSession } from "@/lib/queries";
import { Skeleton } from "@/components/ui/misc";
import { LoadError } from "@/components/records/load-error";

const COLLAPSE_KEY = "suite-sidebar-collapsed";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: meta, isLoading } = useAppMeta();
  const {
    data: session,
    isPending: sessionPending,
    isError: sessionFailed,
    refetch: refetchSession,
  } = useSession();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);

  // Read on mount rather than in the initial state so the server and the first
  // client render agree; flipping width during hydration would be a visible jump.
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage blocked: stay expanded */
    }
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* not worth failing a click over */
      }
      return next;
    });

  const modules = meta?.modules ?? [];

  // Nothing is drawn until we know who is asking.
  //
  // Rendering the shell first and correcting afterwards is not free: every
  // screen inside it starts fetching immediately, and for a session with no
  // workspace all of those come back 401. The proxy answers a 401 by spending
  // the refresh token, refresh tokens rotate, and a dozen of them racing means
  // all but one are rejected -- the session is destroyed by its own loading
  // state. So wait.
  if (sessionPending && !session) {
    return (
      <div className="flex h-dvh flex-col gap-3 p-5">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-72 w-full" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  // The service being unreachable is its own screen. Falling through to the
  // shell paints an app whose every panel is empty, which reads as data loss;
  // holding the loading state paints nothing at all, which reads as broken.
  if (sessionFailed && !session) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-muted p-6">
        <div className="w-full max-w-sm">
          <LoadError what="workspace" onRetry={() => refetchSession()} />
        </div>
      </div>
    );
  }

  // A session can exist before a workspace does. There is no sidebar to draw
  // for a person who belongs nowhere yet, so the whole shell is replaced by the
  // two choices they actually have.
  if (session && !session.organization) {
    return <ChooseWorkspace session={session} />;
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop: a permanent column, collapsible to an icon rail. */}
      <Sidebar
        modules={modules}
        loading={isLoading}
        className="hidden md:flex"
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* Phone: the same nav as an overlay drawer, always full width - a rail
          inside a drawer would save nothing and cost the labels. */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <Sidebar
            modules={modules}
            loading={isLoading}
            onNavigate={() => setNavOpen(false)}
            className="absolute inset-y-0 left-0 z-50 shadow-lg"
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar session={session} onSearch={() => setPaletteOpen(true)} />
        {/* pb-16 clears the fixed bottom bar, which would otherwise cover the
            last row of any list. */}
        <main className="min-h-0 flex-1 overflow-y-auto pb-16 scrollbar-thin md:pb-0">
          {children}
        </main>
      </div>

      <BottomNav
        modules={modules}
        onSearch={() => setPaletteOpen(true)}
        onMenu={() => setNavOpen(true)}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
