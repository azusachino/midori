import { PageSection } from "../components/PageSection";
import { copy } from "../copy";

export function NotFoundPage() {
  return (
    <PageSection title={copy.pages.notFound.title}>
      <p>{copy.pages.notFound.body}</p>
      <p>
        <a href="/briefing">{copy.pages.notFound.back}</a>
      </p>
    </PageSection>
  );
}
