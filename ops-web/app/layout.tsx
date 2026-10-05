import type { Metadata, Viewport } from "next";
import "../../web/app/globals.css";
import { Providers } from "./providers";
// Same key as web/lib/theme.ts (that module is client-only, so it can't be imported here).
const THEME_KEY = "coolservices.theme";

export const metadata: Metadata = {
  title: "Sundays | Operations",
  description: "Requests, facilities and AVL quoting for your church team.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0d12" };

// The website follows the device's light / dark setting until someone picks one.
const boot = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.dataset.theme=d;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: boot }} /></head>
      <body className="min-h-screen"><Providers>{children}</Providers></body>
    </html>
  );
}
