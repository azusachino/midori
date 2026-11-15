import { type MouseEvent, useEffect, useId, useState } from "react";
import { copy } from "./copy";
import { BriefingPage } from "./pages/Briefing";
import { ImportPage } from "./pages/Import";
import { InvestigatePage } from "./pages/Investigate";
import { NotFoundPage } from "./pages/NotFound";
import "./styles/app.css";

/** Hand-rolled routing (v0: three pages, no router library). */
export const ROUTES = [
  { path: "/briefing", label: copy.nav.briefing, Page: BriefingPage },
  { path: "/investigate", label: copy.nav.investigate, Page: InvestigatePage },
  { path: "/import", label: copy.nav.import, Page: ImportPage },
] as const;

/** Maps a pathname to a page; "/" lands on the briefing. */
export function resolveRoute(pathname: string): (typeof ROUTES)[number] | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return ROUTES[0];
  return ROUTES.find((r) => r.path === normalized) ?? null;
}

function currentPath(): string {
  return window.location.pathname;
}

export function App() {
  const mainId = useId();
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const route = resolveRoute(path);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (window.location.pathname !== to) window.history.pushState(null, "", to);
    setPath(to);
  };

  return (
    <>
      <a className="skip-link" href={`#${mainId}`}>
        {copy.app.skipToContent}
      </a>
      <div className="shell">
        <header className="shell__header">
          <span className="shell__brand">{copy.app.name}</span>
          <span className="shell__tagline">{copy.app.tagline}</span>
        </header>
        <nav className="shell__nav" aria-label={copy.nav.label}>
          <ul>
            {ROUTES.map((r) => (
              <li key={r.path}>
                <a
                  href={r.path}
                  aria-current={route?.path === r.path ? "page" : undefined}
                  onClick={(e) => navigate(e, r.path)}
                >
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main id={mainId} className="shell__main" tabIndex={-1}>
          {route ? <route.Page /> : <NotFoundPage />}
        </main>
      </div>
    </>
  );
}
