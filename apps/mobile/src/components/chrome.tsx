import * as React from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BusinessSheet } from "@/components/business-list";
import { SearchPanel } from "@/components/search-panel";
import { useTheme } from "@/lib/theme";

type Chrome = {
  openSearch: () => void;
  openBusinesses: () => void;
};

const Ctx = React.createContext<Chrome | null>(null);

/**
 * The two things the app bar opens, wherever you are.
 *
 * Both used to be somewhere else: search was a screen you navigated to, which
 * meant leaving the page you wanted to search from and finding your way back,
 * and the business list belonged to whichever screen happened to draw a
 * heading. They are held here and drawn above everything, so any page can open
 * either without moving.
 */
export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = React.useState(false);
  const [businesses, setBusinesses] = React.useState(false);

  const value = React.useMemo<Chrome>(
    () => ({ openSearch: () => setSearching(true), openBusinesses: () => setBusinesses(true) }),
    [],
  );

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* Over the page rather than instead of it: the search you opened from
          a list closes back onto that list. */}
      <Modal visible={searching} animationType="fade" onRequestClose={() => setSearching(false)}>
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
          <SearchPanel onClose={() => setSearching(false)} />
        </View>
      </Modal>

      <BusinessSheet open={businesses} onClose={() => setBusinesses(false)} />
    </Ctx.Provider>
  );
}

export function useChrome() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useChrome outside ChromeProvider");
  return ctx;
}
