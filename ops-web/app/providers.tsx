"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { currentTheme } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } } }));
  const [toastTheme, setToastTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setToastTheme(currentTheme());
    const obs = new MutationObserver(() => setToastTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster theme={toastTheme} position="bottom-right"
        toastOptions={{ style: { background: "rgb(var(--c-raised))", border: "1px solid rgb(var(--c-line))", color: "rgb(var(--c-ink))" } }} />
    </QueryClientProvider>
  );
}
