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
  // The running hippo, drawn by scripts/make-icons.mjs. iPhones take no SVG
  // for the home screen, so theirs is a PNG.
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

// viewportFit "cover" lets the safe-area insets reach the sticky header and nav.
// No themeColor here: the script below writes it, because it follows the
// theme chosen on this phone, which the server cannot know.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Runs before anything paints, so the page never shows one theme and then
 * swaps. Only a stored light choice is light. Anything else, including an
 * older device choice, is dark. The browser's bar takes the same background,
 * so a light page no longer sits under a black status bar.
 */
const THEME_SCRIPT = `(function(){var t='dark';try{if(localStorage.getItem('athx-theme')==='light')t='light'}catch(e){}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m)}m.content=t==='light'?'#ffffff':'#0a0a0a'})()`;

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
