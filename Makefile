# Browser verification targets, adapted from the playwright-verify skill.
# The lifecycle (fixture db + web build + server) lives in scripts/e2e/run.ts.
E2E_INSTALL_FLAGS ?=
.PHONY: e2e e2e-probe e2e-install

e2e: ## Verify the web UI in headless Chromium (ARGS='-g "name"' to filter)
	bun scripts/e2e/run.ts $(ARGS)

e2e-probe: ## Screenshot one route before a spec exists (ROUTE=/path)
	bun scripts/e2e/run.ts --project probe PROBE_ROUTE=$(ROUTE)

e2e-install: ## Install the Chromium build this Playwright version needs
	bunx playwright install $(E2E_INSTALL_FLAGS) chromium
