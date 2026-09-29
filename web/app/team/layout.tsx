import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Team check-ins",
  appleWebApp: { capable: true, title: "Check-ins", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d12",
};

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children;
}
