/** Wraps every route so page changes get a soft rise-in. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
