import type { Metadata, Viewport } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import InstallPrompt from "@/components/InstallPrompt";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bagayi Accounting",
  description: "Budget and expense management for your finances",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Budget Tracker",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#11141b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <script
          // Set theme before React hydration to avoid flashing.
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else document.documentElement.dataset.theme = 'dark';
  } catch { /* ignore */ }
})();`,
          }}
        />
        <Auth0Provider>
          {children}
          <InstallPrompt />
        </Auth0Provider>
      </body>
    </html>
  );
}
