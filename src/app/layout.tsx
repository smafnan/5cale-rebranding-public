import type { Metadata } from "next";
import { Archivo, Space_Grotesk } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import ThemeController from "@/components/ThemeController";
import PencilCursor from "@/components/PencilCursor";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://5cale.com"),
  title: {
    default: "5CALE® — The Growth Studio",
    template: "%s — 5CALE®",
  },
  description:
    "Websites, apps, brands, content and AI — everything you need to go from idea to inevitable. In five acts.",
  openGraph: {
    title: "5CALE® — The Growth Studio",
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
    <html lang="en" className={`${archivo.variable} ${grotesk.variable} antialiased`}>
      <body>
        <SmoothScroll>
          <ThemeController />
          <Nav />
          {children}
          <Footer />
        </SmoothScroll>
        <PencilCursor />
      </body>
    </html>
  );
}
