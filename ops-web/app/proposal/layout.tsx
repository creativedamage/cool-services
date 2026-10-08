import type { Metadata, Viewport } from "next";

/** Clients see the business's proposal, not Sundays: a plain title, and never indexed. */
export const metadata: Metadata = { title: "Proposal", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff", colorScheme: "light" };

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
