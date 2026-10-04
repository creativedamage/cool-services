"use client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import { THEME_KEY, currentTheme, setTheme } from "@/lib/theme";
import { CHANGES } from "@/lib/prefs";
import type { ThemePref } from "@shared/types";

// Saving in one window (e.g. Preferences) refreshes the others.
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANGES) : null;
import { Toaster } from "sonner";
import { WavesRelay } from "@/components/WavesRelay";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({ onSuccess: () => channel?.postMessage("saved") }),
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
        },
      }),
  );
  const [toastTheme, setToastTheme] = useState<"dark" | "light">("dark");
  // Apply the saved theme (from Settings) and keep toasts matching it.
  useEffect(() => {
    Api.settings().then((s) => { setTheme(s.theme); setToastTheme(currentTheme()); }).catch(() => {});
    const obs = new MutationObserver(() => setToastTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY && e.newValue) setTheme(e.newValue as ThemePref); };
    window.addEventListener("storage", onStorage);
    const onSaved = () => void client.invalidateQueries();
    channel?.addEventListener("message", onSaved);
    return () => { obs.disconnect(); window.removeEventListener("storage", onStorage); channel?.removeEventListener("message", onSaved); };
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      {children}
      <WavesRelay />
      <Toaster
        theme={toastTheme}
        position="bottom-right"
        toastOptions={{ style: { background: "rgb(var(--c-raised))", border: "1px solid rgb(var(--c-line))", color: "rgb(var(--c-ink))" } }}
      />
    </QueryClientProvider>
  );
}
