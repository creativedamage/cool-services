import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Clock", appleWebApp: { capable: true, title: "Clock", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

export default function ClockOutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
