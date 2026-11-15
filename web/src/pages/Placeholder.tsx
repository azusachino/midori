import { PageSection } from "../components/PageSection";

/** Shared placeholder body until a page's task lands real content. */
export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <PageSection title={title}>
      <p className="placeholder">{body}</p>
    </PageSection>
  );
}
