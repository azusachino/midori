import { LoadingState } from "./LoadingState";

export function RouteFallback() {
  return <LoadingState variant="rows" count={4} />;
}
