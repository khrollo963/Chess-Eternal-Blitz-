import { BunWebSockets, type TransportOptions } from '@colyseus/bun-websockets';
import { createAuthContext, runBeforeUpgrade, type AuthContext, type Router } from '@colyseus/core';
import { IncomingMessage, ServerResponse } from 'bun-serve-express';
import type { ServerWebSocket } from 'bun';
import { HTTP_PAYLOAD_BYTES, WEBSOCKET_PAYLOAD_BYTES, TransportSecurity, readBoundedJson } from './transport-security.js';

export type TrustedIngressPolicy = 'railway-edge-only' | 'local-fixture';
interface SocketData { url: string; searchParams: URLSearchParams; headers: Headers; remoteAddress: string; context?: AuthContext }
const failure = (status: number, code: string) => Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
/** Raw boundary adapter for installed Bun transport 0.18.3.
 * Reuses its protected connection/wrapper implementation without touching runtime-private state.
 */
export class SecureBunWebSockets extends BunWebSockets {
  private rawServer?: Bun.Server<SocketData>;
  private rawRouter?: Router;
  private readonly websocketOptions: TransportOptions;
  constructor(options: TransportOptions, private readonly boundary: {
    security: TransportSecurity; ingressPolicy: TrustedIngressPolicy; clock?: () => number;
  }) {
    super(options); this.websocketOptions = { ...options, maxPayloadLength: WEBSOCKET_PAYLOAD_BYTES };
    if (!['railway-edge-only', 'local-fixture'].includes(boundary.ingressPolicy)) throw new Error('Invalid ingress policy');
  }
  override bindRouter(router: Router) { this.rawRouter = router; }
  override listen(port: number, hostname?: string, _backlog?: number, listeningListener?: () => void): this {
    if (this.boundary.ingressPolicy === 'local-fixture' && !['127.0.0.1', 'localhost', '::1'].includes(hostname ?? '')) throw new Error('Local fixture must bind loopback');
    const { beforeUpgrade, ...websocketOptions } = this.websocketOptions;
    const app = this.getExpressApp(), security = this.boundary.security;
    this.rawServer = Bun.serve<SocketData>({
      port, hostname, maxRequestBodySize: HTTP_PAYLOAD_BYTES,
      fetch: async (original, server) => {
        try {
          const url = new URL(original.url), upgrade = original.headers.get('upgrade')?.toLowerCase() === 'websocket';
          // requestIP is the native socket peer. Railway edge peers share quotas deliberately.
          // No forwarded header or Colyseus context.ip is a trusted source or TLS signal.
          const nativePeer = server.requestIP(original)?.address;
          const trusted = { sourceKey: nativePeer, secure: this.boundary.ingressPolicy === 'railway-edge-only' ||
            (this.boundary.ingressPolicy === 'local-fixture' && !!nativePeer && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(nativePeer)) };
          const rejection = security.guard(original, trusted, (this.boundary.clock ?? Date.now)(), upgrade ? 'upgrade' : undefined);
          if (rejection) return rejection;
          const cors = security.corsHeaders(original.headers.get('origin'));
          const decorate = (response: Response) => {
            const headers = new Headers(response.headers);
            // Never inherit Colyseus's permissive/default CORS headers.
            for (const name of [...headers.keys()]) if (name.startsWith('access-control-')) headers.delete(name);
            for (const [name, value] of Object.entries(cors)) headers.set(name, value);
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
          };
          if (upgrade) {
            const context = createAuthContext({ headers: original.headers, token: url.searchParams.get('_authToken'), remoteAddress: nativePeer ?? 'unknown' });
            if (beforeUpgrade) { const response = await runBeforeUpgrade(beforeUpgrade, url.pathname + url.search, context); if (response) return decorate(response); }
            if (server.upgrade(original, { data: { url: url.pathname, searchParams: url.searchParams, headers: original.headers, remoteAddress: nativePeer ?? 'unknown', context } })) return;
            return decorate(failure(400, 'invalid_command'));
          }
          if (original.method === 'OPTIONS') return decorate(new Response(null, { status: 204 }));
          if (!['GET', 'HEAD', 'POST'].includes(original.method)) return decorate(failure(405, 'invalid_command'));
          let request = original;
          if (original.method === 'POST') {
            // The installed router and Express adapter both read whole bodies: fence first.
            const body = JSON.stringify(await readBoundedJson(original));
            const headers = new Headers(original.headers); headers.delete('content-length'); headers.delete('transfer-encoding');
            request = new Request(original.url, { method: original.method, headers, body });
          }
          if (this.rawRouter?.findRoute(request.method, url.pathname) !== undefined) return decorate(await this.rawRouter.handler(request));
          const incoming = new IncomingMessage(request, url, app), response = new ServerResponse(incoming, app);
          if (request.method === 'POST') incoming.body = await request.text();
          incoming.complete = true;
          // bun-serve-express exposes its installed request dispatcher as handle().
          (app as unknown as { handle(request: IncomingMessage, response: ServerResponse): void }).handle(incoming, response);
          return decorate(await response.getBunResponse());
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          return failure(code === 'payload_too_large' ? 413 : code === 'invalid_command' ? 400 : 503,
            code === 'payload_too_large' || code === 'invalid_command' ? code : 'storage_unavailable');
        }
      },
      websocket: {
        ...websocketOptions,
        open: async (socket: ServerWebSocket<SocketData>) => { await this.onConnection(socket); },
        message: (socket, message) => { this.clientWrappers.get(socket)?.emit('message', Buffer.from(message)); },
        close: (socket, code) => {
          const index = this.clients.indexOf(socket); if (index >= 0) this.clients.splice(index, 1);
          const wrapper = this.clientWrappers.get(socket);
          if (wrapper) { this.clientWrappers.delete(socket); wrapper.emit('close', code); }
        },
      },
    });
    listeningListener?.(); return this;
  }
  override shutdown() { this.rawServer?.stop(true); }
}
