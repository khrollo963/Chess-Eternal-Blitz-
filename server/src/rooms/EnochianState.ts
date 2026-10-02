import { schema, t } from "@colyseus/schema";

// Only public committed fields belong in Schema. Domain state arrives in Task 5.
export const EnochianState = schema({
  phase: t.string(),
  revision: t.number(),
  connected: t.number(),
  lastLobbyMessage: t.string(),
}, "EnochianState");
export type PublicState = InstanceType<typeof EnochianState>;
