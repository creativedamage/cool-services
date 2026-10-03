import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Stage display", appleWebApp: { capable: true, title: "Stage display", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

export default function DisplayOutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
