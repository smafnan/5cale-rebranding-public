import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-5 text-center">
      <p className="label opacity-60">[ Lost between acts ]</p>
      <h1 className="display outline-text text-[30vw] leading-none md:text-[16vw]">404</h1>
      <p className="max-w-sm opacity-80">
        This page didn&apos;t survive the rebrand. The good stuff is one click away.
      </p>
      <Link
        href="/"
        className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium uppercase tracking-wide text-[#0b0b0b] transition-transform hover:scale-105"
      >
        Back home
      </Link>
    </main>
  );
}
