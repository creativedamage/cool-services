"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import { currentTheme, setTheme } from "@/lib/theme";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
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
    return () => obs.disconnect();
  }, []);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        theme={toastTheme}
        position="bottom-right"
        toastOptions={{ style: { background: "rgb(var(--c-raised))", border: "1px solid rgb(var(--c-line))", color: "rgb(var(--c-ink))" } }}
      />
    </QueryClientProvider>
  );
}
