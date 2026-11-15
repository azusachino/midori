/**
 * `bun run dev`: the Bun API (src/server.ts) and the Vite dev server (web/, port 5173,
 * proxies /api to the API port). Both children stop together on Ctrl-C or when either exits.
 */
const apiPort = process.env.MIDORI_PORT ?? "5174";
const env = { ...process.env, MIDORI_PORT: apiPort };

const children = [
  Bun.spawn(["bun", "src/server.ts"], { env, stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bunx", "--bun", "vite", "--config", "web/vite.config.ts"], {
    env,
    stdout: "inherit",
    stderr: "inherit",
  }),
];

let stopping = false;
function stopAll(code: number): never {
  if (!stopping) {
    stopping = true;
    for (const child of children) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => stopAll(130));
process.on("SIGTERM", () => stopAll(143));

// First child to exit ends the whole dev session.
const first = await Promise.race(
  children.map((child, i) => child.exited.then((code) => ({ i, code }))),
);
console.error(`dev: ${first.i === 0 ? "API" : "Vite"} exited with code ${first.code}; stopping`);
stopAll(first.code === 0 ? 1 : first.code);

export {};
