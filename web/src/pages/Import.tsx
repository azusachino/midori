import { copy } from "../copy";
import { Placeholder } from "./Placeholder";

export function ImportPage() {
  return <Placeholder title={copy.pages.import.title} body={copy.pages.import.placeholder} />;
}
