import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { themeBootScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Cool Services",
  description: "Volunteer workflows and service scheduling, powered by Planning Center",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
