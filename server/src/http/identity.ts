import type { BunWebSockets } from '@colyseus/bun-websockets';
import type { SupabaseIdentityConfig } from '../identity/supabase.js';

type App = ReturnType<BunWebSockets['getExpressApp']>;
/** Only public Auth configuration; no database/service-role credential is exposed. */
export function registerIdentityConfiguration(app: App, config: SupabaseIdentityConfig | undefined, rankedEnabled = false) {
  app.get('/identity/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!config) { res.status(503).json({ code: 'identity_unavailable', rankedEnabled: false }); return; }
    res.json({ url: config.url, publishableKey: config.publishableKey, providers: ['email'], rankedEnabled });
  });
}
