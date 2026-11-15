import type { ReactNode } from "react";

export function PageSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      {children}
    </section>
  );
}
