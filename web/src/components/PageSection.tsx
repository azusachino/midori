import type { ReactNode } from "react";

export function PageSection({
  title,
  lead,
  children,
}: {
  title: string;
  /** Muted one-liner under the title (e.g. "as of 2026-11-07"). */
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <h1>{title}</h1>
      {lead !== undefined && <p className="muted page__lead">{lead}</p>}
      {children}
    </section>
  );
}
