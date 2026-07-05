"use client";

import { useState } from "react";
import { CONTACT_EMAIL } from "@/lib/data";

// NOTE: opens the visitor's mail client with a pre-filled brief.
// Swap for a real form backend (Resend, Formspree, API route) before launch.
export default function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", about: "" });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`New project — ${form.name || "hello"}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\n\nThe project:\n${form.about}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  const field =
    "w-full border-b border-current/30 bg-transparent py-3 text-lg outline-none transition-colors placeholder:opacity-40 focus:border-[var(--accent)]";

  return (
    <form onSubmit={submit} className="flex w-full max-w-xl flex-col gap-8">
      <label className="flex flex-col gap-2">
        <span className="label opacity-60">Your name</span>
        <input
          className={field}
          placeholder="Ada Lovelace"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="label opacity-60">Email</span>
        <input
          className={field}
          type="email"
          placeholder="ada@company.com"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="label opacity-60">The project</span>
        <textarea
          className={`${field} min-h-28 resize-y`}
          placeholder="What are we building, branding or growing?"
          value={form.about}
          onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))}
        />
      </label>
      <button
        type="submit"
        className="w-fit cursor-pointer rounded-full bg-[var(--ink)] px-8 py-4 text-sm font-medium uppercase tracking-wide text-[var(--bg)] transition-transform hover:scale-105"
      >
        Send the brief →
      </button>
    </form>
  );
}
