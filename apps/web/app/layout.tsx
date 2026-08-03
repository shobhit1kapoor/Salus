import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Salus", template: "%s · Salus" },
  description: "Protected health intelligence for patients and authorized caregivers.",
  applicationName: "Salus",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Salus",
    description: "Protected health intelligence for patients and authorized caregivers.",
    type: "website",
    images: [{ url: "/og-blue-red.png", width: 1734, height: 907, alt: "Salus privacy-first health intelligence" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Salus",
    description: "Protected health intelligence for patients and authorized caregivers.",
    images: ["/og-blue-red.png"]
  }
};

export const viewport: Viewport = { themeColor: "#0c5f5b", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={inter.variable}>{children}</body></html>;
}
