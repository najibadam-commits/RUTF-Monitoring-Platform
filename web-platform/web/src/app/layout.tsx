import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "RUTF Monitoring Platform",
  description: "Third-Party Monitoring & live GIS oversight for field-reported findings across Nigeria.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      {/* suppressHydrationWarning here only ignores attribute mismatches on
          this element (e.g. Grammarly/other extensions injecting
          data-gr-ext-installed / data-new-gr-c-s-check-loaded into <body>
          before React hydrates) — it does not silence real hydration
          mismatches elsewhere in the tree. */}
      <body className="h-full" suppressHydrationWarning>
        {children}
        {/* Phosphor Icons — matches the design handoff's own asset choice
            (README: "icons are Phosphor Icons (ph classes) loaded from a
            CDN"). Keeps every <i className="ph ph-*"> in the app working
            without porting each usage to the React component package.
            Pinned to an exact version (npm registry's published "latest" as
            of this change — unpkg mirrors npm 1:1 by version) rather than
            the unversioned /@phosphor-icons/web URL: unpinned, the browser
            can never cache this script beyond an in-memory hit (the URL
            never changes but its content silently can), and every new
            release ships to production without anyone reviewing it. */}
        <Script src="https://unpkg.com/@phosphor-icons/web@2.1.2" strategy="afterInteractive" />
      </body>
    </html>
  );
}
