import type { Metadata } from "next";
import ServiceRows from "@/components/services/ServiceRows";
import TagDrop from "@/components/services/TagDrop";
import Reveal from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Websites, mobile apps, Shopify, branding, content, marketing, social, SEO and AI integration. Ten services, one studio.",
};

export default function ServicesPage() {
  return (
    <main id="main-content" tabIndex={-1} data-page-theme="base" className="pb-16 pt-36 focus:outline-none">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <p className="label mb-4 opacity-60">[ What we do ]</p>
        <Reveal variant="wipe">
          <h1 className="font-slash mb-6 text-6xl md:text-[6.5vw]">
            Ten weapons.
            <br />
            One studio.
          </h1>
        </Reveal>
        <Reveal variant="blur" delay={0.12}>
          <p className="mb-16 max-w-md text-lg opacity-80">
            Hover through the arsenal. Every service plugs into the five-act
            system. Use one, or run the whole climb.
          </p>
        </Reveal>
        <ServiceRows />
      </div>
      <TagDrop />
    </main>
  );
}
