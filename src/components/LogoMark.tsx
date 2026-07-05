/** The 5cale mark: five ascending bars — a staircase, an equalizer, a 5. */
export default function LogoMark({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 20" fill="currentColor" className={className} aria-hidden>
      <rect x="0" y="14" width="3.5" height="6" />
      <rect x="5.5" y="11" width="3.5" height="9" />
      <rect x="11" y="8" width="3.5" height="12" />
      <rect x="16.5" y="4" width="3.5" height="16" />
      <rect x="22" y="0" width="3.5" height="20" />
    </svg>
  );
}
