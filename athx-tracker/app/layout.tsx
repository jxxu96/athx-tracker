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
  // The page defaults to dark, including on a light device, so the browser
  // chrome matches that instead of the operating system.
  themeColor: "#0a0a0a",
};

/**
 * Runs before anything paints, so the page never shows one theme and then
 * swaps. A missing choice is dark. "system" follows the device. Light and
 * dark are used as stored.
 */
const THEME_SCRIPT = `try{var s=localStorage.getItem('athx-theme');var d=s==='light'?false:s==='system'?window.matchMedia('(prefers-color-scheme: dark)').matches:true;document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The script below sets data-theme, which the server cannot know about.
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
