import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auth0 Next.js App",
  description: "Next.js app with Auth0 authentication",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
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