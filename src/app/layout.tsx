import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdPulse Analytics",
  description: "Performance marketing reporting dashboard",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
