import type { Metadata } from "next";
import "./globals.css";
import { AuthShell } from "@/components/layout/AuthShell";

export const metadata: Metadata = {
  title: "Change Detective",
  description: "Storage change monitoring dashboard",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-bg-page text-white md:h-screen md:flex-row md:overflow-hidden">
        <AuthShell>{children}</AuthShell>
      </body>
    </html>
  );
}

