import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export async function snapShot(
  page: Page,
  name: string,
  opts?: { fullPage?: boolean },
): Promise<void> {
  const dir = process.env.MIDORI_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: opts?.fullPage ?? true });
}
