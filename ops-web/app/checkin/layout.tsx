import type { Metadata, Viewport } from "next";

/** Team check-ins: its own name and icon when saved to a phone's home screen. */
export const metadata: Metadata = {
  title: "Check-ins",
  description: "See who’s here on each team and check people in.",
  manifest: "/checkin/manifest.webmanifest",
  icons: {
    icon: [{ url: "/checkin/icon.svg", type: "image/svg+xml" }, { url: "/checkin/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/checkin/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Check-ins", statusBarStyle: "black-translucent" },
  other: { "mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0e16" };

export default function CheckinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
