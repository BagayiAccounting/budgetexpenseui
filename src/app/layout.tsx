import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bagayi Accounting",
  description: "Budget and expense management for your finances",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
        </Auth0Provider>
      </body>
    </html>
  );
}
