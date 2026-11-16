import type { Metadata } from "next";
import "./globals.css";
import { AuthShell } from "@/components/layout/AuthShell";

export const metadata: Metadata = {
  title: "Change Detective",
  description: "Storage change monitoring dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen bg-bg-page text-white overflow-hidden">
        <AuthShell>{children}</AuthShell>
      </body>
    </html>
  );
}

