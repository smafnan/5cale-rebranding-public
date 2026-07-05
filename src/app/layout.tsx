import type { Metadata } from "next";
import { Archivo, Space_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import ThemeController from "@/components/ThemeController";
import PencilCursor from "@/components/PencilCursor";
import InvertCursor from "@/components/InvertCursor";
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
      <body>
        <SmoothScroll>
          <ThemeController />
          <Nav />
          {children}
          <Footer />
        </SmoothScroll>
        <PencilCursor />
        <InvertCursor />
      </body>
    </html>
  );
}
