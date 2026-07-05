import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import { CONTACT_EMAIL } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contact",
  description: "Start a project with 5cale.",
};

export default function ContactPage() {
  return (
    <main data-page-theme="brand" className="px-5 pb-24 pt-36 md:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="label mb-4 opacity-60">[ New business ]</p>
        <h1 className="display mb-10 text-[16vw] leading-[0.85] md:text-[10vw]">
          Let&apos;s
          <br />
          5cale.
        </h1>

        <div className="grid gap-16 md:grid-cols-2">
          <ContactForm />

          <div className="flex flex-col gap-10 md:items-end md:text-right">
            <div>
              <p className="label mb-2 opacity-60">Prefer email?</p>
              <a href={`mailto:${CONTACT_EMAIL}`} className="link-sweep text-2xl md:text-3xl">
                {CONTACT_EMAIL}
              </a>
            </div>
            <div>
              <p className="label mb-2 opacity-60">Based</p>
              <p className="text-lg">Everywhere. Shipping worldwide.</p>
            </div>
            <div>
              <p className="label mb-2 opacity-60">Elsewhere</p>
              <div className="flex gap-4 md:justify-end">
                <a href="#" className="link-sweep">Instagram</a>
                <a href="#" className="link-sweep">LinkedIn</a>
                <a href="#" className="link-sweep">X</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
