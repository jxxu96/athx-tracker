import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hippos & Gators · ATHX 2027",
  description: "Two athletes. One start line. Your shared ATHX Lite training and nutrition journal.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Hippos & Gators",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

// viewportFit "cover" lets the safe-area insets reach the sticky header and nav.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
