import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  acceptPendingInvitation,
  createWorkspaceRequest,
  loadStoredTokens,
  onSessionLost,
  registerRequest,
  signInRequest,
  storeTokens,
  switchWorkspaceRequest,
} from "@/lib/api";

type Status = "loading" | "signedOut" | "signedIn";

type SessionState = {
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (body: {
    name: string;
    email: string;
    password: string;
    organization?: string;
    currency?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  switchWorkspace: (organizationId: string) => Promise<void>;
  createWorkspace: (organization: string, currency: string) => Promise<void>;
  acceptInvitation: (id: string) => Promise<void>;
};

const Ctx = React.createContext<SessionState | null>(null);

/**
 * Whether there is a session, and the three things that change it.
 *
 * Only whether, not who: what the person may see comes from `auth/me` on every
 * launch, like the web, so a role changed while the app was closed takes
 * effect rather than being remembered from a stale payload.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const qc = useQueryClient();

  React.useEffect(() => {
    let alive = true;
    loadStoredTokens().then((t) => {
      if (alive) setStatus(t ? "signedIn" : "signedOut");
    });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    // A refresh token that is spent, revoked or expired ends the session
    // wherever the app happens to be. The cache goes with it: it holds one
    // business's records, and it must not be there for whoever signs in next.
    onSessionLost(() => {
      qc.clear();
      setStatus("signedOut");
    });
  }, [qc]);

  const value = React.useMemo<SessionState>(
    () => ({
      status,
      signIn: async (email, password) => {
        await signInRequest(email, password);
        qc.clear();
        setStatus("signedIn");
      },
      signUp: async (body) => {
        await registerRequest(body);
        qc.clear();
        setStatus("signedIn");
      },
      // Local only, deliberately: the API's logout revokes every refresh token
      // the person holds, which would sign them out of the browser on their
      // desk because they closed the app on their phone.
      signOut: async () => {
        await storeTokens(null);
        qc.clear();
        setStatus("signedOut");
      },
      switchWorkspace: async (organizationId) => {
        await switchWorkspaceRequest(organizationId);
        // Every cached answer belongs to the business being left.
        qc.clear();
      },
      createWorkspace: async (organization, currency) => {
        // The reply is already a session inside the new business, so there is
        // nothing to switch to afterwards.
        await createWorkspaceRequest(organization, currency);
        qc.clear();
      },
      // Accepting says which business was joined; the session still belongs to
      // whatever was open before, so it moves.
      acceptInvitation: async (id) => {
        const joined = await acceptPendingInvitation(id);
        if (joined.organization_id) await switchWorkspaceRequest(joined.organization_id);
        qc.clear();
      },
    }),
    [status, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionState() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useSessionState outside SessionProvider");
  return ctx;
}
