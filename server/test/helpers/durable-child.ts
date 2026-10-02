import { startServer } from '../../src/recovery/start-server.js';
await startServer(process.env, { storeHooks: { async afterCommit(input) {
  if (input.next.engine.moveCount > 0) {
    console.info(JSON.stringify({ testCommitted: true, matchId: input.matchId }));
    await new Promise<void>(() => {});
  }
} } });
