/** The 5cale pixel mark: a bitmap "5" on a 5×7 grid. */
export default function LogoMark({ className = "h-6 w-auto" }: { className?: string }) {
  const rows = [
    "XXXXX",
    "X....",
    "XXXX.",
    "....X",
    "....X",
    "X...X",
    ".XXX.",
  ];
  return (
    <svg viewBox="0 0 5 7" fill="currentColor" className={className} aria-hidden>
      {rows.flatMap((row, r) =>
        row.split("").map((cell, c) =>
          cell === "X" ? (
            <rect key={`${r}-${c}`} x={c + 0.06} y={r + 0.06} width={0.88} height={0.88} />
          ) : null
        )
      )}
    </svg>
  );
}
