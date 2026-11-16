# Browser verification targets, adapted from the playwright-verify skill.
# The lifecycle (fixture db + web build + server) lives in scripts/e2e/run.ts.
E2E_INSTALL_FLAGS ?=
.PHONY: e2e e2e-probe e2e-install

## --- k3s local image (build with Podman, import into containerd; no registry) ---
# Must match the prefix harus-k3s pins in SERVICE_VERSIONS.yaml and its
# manifests (imagePullPolicy: Never there). Never build with --pull aliases
# that would retag from a registry: the base is a pinned public tag.
IMAGE_NS := azusachino.com
# Image tags are pre-release candidates (0.0.1-rcN), not releases; always pass TAG.
TAG ?= $(error TAG is required, e.g. TAG=0.0.1-rc1)
SOURCE_REVISION ?= $(shell git rev-parse HEAD)$(if $(shell git status --porcelain),-dirty)
.PHONY: image-app image-local images smoke-container

image-app: ## Build the midori image and import it into the local k3s containerd store (TAG=0.0.1-rcN)
	podman build --build-arg SOURCE_REVISION=$(SOURCE_REVISION) -t $(IMAGE_NS)/midori:$(TAG) .
	podman save $(IMAGE_NS)/midori:$(TAG) | sudo k3s ctr images import --all-platforms --digests --skip-digest-for-named -

images: image-app ## Alias used by the ship-to-cluster playbook

image-local: ## Build only, no containerd import (TAG=0.0.1-rcN)
	podman build --build-arg SOURCE_REVISION=$(SOURCE_REVISION) -t $(IMAGE_NS)/midori:$(TAG) .

smoke-container: ## In-container check: image hygiene + import + briefing + MCP (TAG=0.0.1-rcN)
	bun scripts/smoke-container.ts --image $(IMAGE_NS)/midori:$(TAG)

e2e: ## Verify the web UI in headless Chromium (ARGS='-g "name"' to filter)
	bun scripts/e2e/run.ts $(ARGS)

e2e-probe: ## Screenshot one route before a spec exists (ROUTE=/path)
	bun scripts/e2e/run.ts --project probe PROBE_ROUTE=$(ROUTE)

e2e-install: ## Install the Chromium build this Playwright version needs
	bunx playwright install $(E2E_INSTALL_FLAGS) chromium
