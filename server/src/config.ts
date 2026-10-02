import { SUPPORTED_SIGNIN_PROVIDERS, type SignInProvider } from './http/signin.js';

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
  const providers = env.MULTIPLAYER_SIGNIN_PROVIDERS === undefined ? ['email'] : env.MULTIPLAYER_SIGNIN_PROVIDERS.split(',').map(value => value.trim());
  if (!providers.length || providers.some(provider => !SUPPORTED_SIGNIN_PROVIDERS.includes(provider as SignInProvider))) throw new Error('Invalid sign-in providers');
  return { port, hostname: env.HOST ?? "0.0.0.0", rankedEnabled: ranked === 'true', signInProviders: [...new Set(providers)] as SignInProvider[] };
}
