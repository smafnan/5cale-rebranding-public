import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import Reveal from "@/components/Reveal";
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
        <Reveal variant="pop">
          <h1 className="font-pixel mb-10 text-[15vw] leading-[1.05] md:text-[9vw]">
            Let&apos;s
            <br />
            5cale.
          </h1>
        </Reveal>

        <div className="grid gap-16 md:grid-cols-2">
          <Reveal variant="skew">
            <ContactForm />
          </Reveal>

          <Reveal variant="blur" delay={0.1}>
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
          </Reveal>
        </div>
      </div>
    </main>
  );
}
