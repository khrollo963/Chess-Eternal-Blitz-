import { matchMaker } from '@colyseus/core';
import type { BunWebSockets } from '@colyseus/bun-websockets';
import type { LobbyService } from '../domain/lobby.js';
import type { VerifiedAuth } from '../storage/LobbyStore.js';
import type { Color } from '../domain/match.js';
import { publicSnapshot } from '../domain/match.js';

type App = ReturnType<BunWebSockets['getExpressApp']>;
/** Credentials are POST bodies only, never invite URLs or public metadata. */
export function registerInvitations(app: App, lobby: LobbyService, verifyAuth?: (authorization: string | undefined) => Promise<VerifiedAuth | undefined>, isReady?: () => boolean) {
  const body = (input: unknown): Record<string, unknown> => {
    if (typeof input !== 'string' || Buffer.byteLength(input) > 2048) throw new Error('invalid_command');
    let parsed: unknown;
    try { parsed = JSON.parse(input); } catch { throw new Error('invalid_command'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('invalid_command');
    return parsed as Record<string, unknown>;
  };
  const safeError = (error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    const allowed = ['invalid_command','invalid_name','invalid_color','invalid_mode','unauthorized','duplicate_account','duplicate_connection','deadline_expired','invalid_phase','not_found','room_full','color_unavailable','ranked_disabled','ranked_match_locked','ranked_cooldown','stale_revision','lobby_capacity'];
    return allowed.includes(code) ? code : 'storage_unavailable';
  };
  app.post('/invitations', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isReady && !isReady()) { res.status(503).json({ code: 'storage_unavailable' }); return; }
    let matchId: string | undefined;
    let room: ReturnType<typeof matchMaker.getLocalRoomById> | undefined;
    try {
      const data = body(req.body);
      const auth = await verifyAuth?.(req.headers.authorization);
      const ticket = await lobby.create(data.mode as 'casual' | 'ranked', data.name as string, data.color as Color, auth);
      matchId = ticket.matchId;
      const transport = await matchMaker.createRoom('enochian', { matchId, creationPermit: lobby.prepareTransport(matchId) });
      room = matchMaker.getLocalRoomById(transport.roomId);
      await lobby.bindRoom(matchId, transport.roomId);
      res.status(201).json({ ...ticket, color: data.color, roomId: transport.roomId });
    } catch (error) {
      if (matchId) { try { await lobby.voidCreation(matchId); } catch { /* unstarted reservation expires absolutely */ } }
      if (room) { try { await room.disconnect(); } catch { /* transport already closed */ } }
      const code = safeError(error); res.status(code === 'storage_unavailable' ? 503 : code === 'lobby_capacity' ? 429 : 400).json({ code });
    }
  });
  app.post('/invitations/join', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isReady && !isReady()) { res.status(503).json({ code: 'storage_unavailable' }); return; }
    try {
      const data = body(req.body);
      const mapping = await lobby.lookup(data.code as string);
      if (!mapping.roomId) throw new Error('storage_unavailable');
      const ticket = await lobby.join(data.code as string, data.name as string, data.color as Color, await verifyAuth?.(req.headers.authorization));
      res.json({ ...ticket, color: data.color, roomId: mapping.roomId });
    } catch (error) { const code = safeError(error); res.status(code === 'storage_unavailable' ? 503 : 400).json({ code }); }
  });
  app.post('/invitations/recover', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isReady && !isReady()) { res.status(503).json({ code: 'storage_unavailable' }); return; }
    try {
      const data = body(req.body);
      const { record, owner, color } = await lobby.authenticate(data.matchId as string, data.credential);
      if (record.mode === 'ranked') {
        const verified = await verifyAuth?.(req.headers.authorization);
        if (!verified || verified.accountId !== owner.accountId) throw new Error('unauthorized');
      }
      if (record.phase === 'finished' || record.phase === 'void') { res.json({ matchId: record.matchId, color, snapshot: publicSnapshot(record) }); return; }
      res.json({ matchId: record.matchId, color, roomId: record.lobby.roomId });
    } catch { res.status(401).json({ code: 'unauthorized' }); }
  });
  app.get('/invitations/:code', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isReady && !isReady()) { res.status(503).json({ code: 'storage_unavailable' }); return; }
    try { res.json(await lobby.lookup(req.params.code as string)); } catch { res.status(404).json({ code: 'not_found' }); }
  });
}
