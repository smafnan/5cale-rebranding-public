import type { Metadata } from "next";
import ServiceRows from "@/components/services/ServiceRows";
import TagDrop from "@/components/services/TagDrop";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Websites, mobile apps, Shopify, branding, content, marketing, social, SEO and AI integration — ten services, one studio.",
};

export default function ServicesPage() {
  return (
    <main data-page-theme="base" className="pb-16 pt-36">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <p className="label mb-4 opacity-60">[ What we do ]</p>
        <h1 className="display mb-6 text-6xl md:text-[7vw]">
          Ten weapons.
          <br />
          One studio.
        </h1>
        <p className="mb-16 max-w-md text-lg opacity-80">
          Hover through the arsenal. Every service plugs into the five-act
          system — use one, or run the whole climb.
        </p>
        <ServiceRows />
      </div>
      <TagDrop />
    </main>
  );
}
