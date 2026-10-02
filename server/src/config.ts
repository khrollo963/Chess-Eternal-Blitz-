export const BUN_VERSION = "1.4.2";

export function assertRuntime(): void {
  if (process.versions.bun !== BUN_VERSION) {
    throw new Error(`Bun ${BUN_VERSION} required; received ${process.versions.bun ?? "Node"}`);
  }
}

export function runtimeDiagnostics() {
  return { runtime: "bun", bun: process.versions.bun, nodeCompatibility: process.versions.node };
}

export function readConfig(env: Record<string, string | undefined> = process.env) {
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const ranked = env.MULTIPLAYER_RANKED_ENABLED;
  if (ranked !== undefined && ranked !== 'true' && ranked !== 'false') throw new Error('Invalid ranked policy');
  return { port, hostname: env.HOST ?? "0.0.0.0", rankedEnabled: ranked === 'true' };
}
