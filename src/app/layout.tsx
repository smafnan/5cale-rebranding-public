import type { Metadata } from "next";
import { Archivo, Space_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import ThemeController from "@/components/ThemeController";
import PencilCursor from "@/components/PencilCursor";
import InvertCursor from "@/components/InvertCursor";
import ChatWidget from "@/components/ChatWidget";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});

// Brand display fonts (from "fonts for 5cale")
const goblock = localFont({ src: "../fonts/goblock.ttf", variable: "--font-goblock" });
const paperSlash = localFont({ src: "../fonts/paper-slash.ttf", variable: "--font-slash" });
const brick = localFont({ src: "../fonts/graffiti-brick.ttf", variable: "--font-brick" });
const brickLine = localFont({ src: "../fonts/graffiti-brick-line.ttf", variable: "--font-brickline" });
const roost = localFont({ src: "../fonts/roost-punk.ttf", variable: "--font-punk" });

export const metadata: Metadata = {
  metadataBase: new URL("https://5cale.com"),
  title: {
    default: "5CALE® · The Growth Studio",
    template: "%s · 5CALE®",
  },
  description:
    "Websites, apps, brands, content and AI. Everything you need to go from idea to inevitable, in five acts.",
  openGraph: {
    title: "5CALE® · The Growth Studio",
    description: "From idea to inevitable, in five acts.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${grotesk.variable} ${goblock.variable} ${paperSlash.variable} ${brick.variable} ${brickLine.variable} ${roost.variable} antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, etc.) inject attributes into <body> before React
          hydrates, which otherwise trips a false-positive mismatch warning. */}
      <body suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#0b0b0b] focus:not-sr-only focus:fixed focus:left-5 focus:top-5"
        >
          Skip to content
        </a>
        <SmoothScroll>
          <ThemeController />
          <Nav />
          {children}
          <Footer />
        </SmoothScroll>
        <ChatWidget />
        <PencilCursor />
        <InvertCursor />
      </body>
    </html>
  );
}
