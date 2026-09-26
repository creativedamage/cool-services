import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Page the Auditorium",
  appleWebApp: { capable: true, title: "Page Parents", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
