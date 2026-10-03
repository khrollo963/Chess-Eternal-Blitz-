import { expect, test } from 'bun:test';
import { CommandProcessor, parseCommand } from '../src/domain/commands.js';
import { createMatch, publicSnapshot, COLORS, type Color } from '../src/domain/match.js';
import { MemoryMatchStore } from '../src/storage/MemoryMatchStore.js';
import { buildRankedSettlement, type RankedRecord } from '../src/domain/ranked.js';
import type { LobbyRecord } from '../src/storage/LobbyStore.js';
import { MemoryLobbyStore } from '../src/storage/MemoryLobbyStore.js';
import { RecoveryCoordinator, type RecoveryRecord } from '../src/recovery/RecoveryCoordinator.js';

test('last usable non-king capture durably finishes as a draw and replays exactly once', async () => {
  const record = createMatch('draw-ending'); record.phase = 'active';
  record.engine = {board:{'2,3':{color:'Y',type:'KING'},'4,3':{color:'K',type:'KING'},'2,4':{color:'K',type:'ROOK'},'0,0':{color:'R',type:'ROOK'}},alive:{R:false,B:false,Y:true,K:true},turnIndex:2,over:false,moveCount:412};
  record.seats.Y = {...record.seats.Y,ownerId:'owner-Y',controller:'human',connected:true};
  const store = new MemoryMatchStore(); await store.create(record);
  const published: unknown[] = [];
  const processor = new CommandProcessor({store,publish:snapshot=>{published.push(snapshot);}});
  const command = {requestId:'last-capture',matchId:record.matchId,expectedRevision:0,protocolVersion:record.protocolVersion,rulesVersion:record.rulesVersion,action:{type:'move',fr:2,fc:3,tr:2,tc:4}};
  const actor = {actorId:'owner-Y',seat:'Y' as const,controller:'human' as const};
  const first = await processor.execute(actor,command);
  expect(first.ok).toBe(true);
  expect(first.snapshot?.terminalResult).toEqual({kind:'draw',winningTeam:null,reason:'bare_kings'});
  expect(first.snapshot?.phase).toBe('finished');
  expect((await store.load(record.matchId))?.engine.over).toBe(true);
  expect(await processor.execute(actor,command)).toEqual(first);
  expect(published).toHaveLength(1);
  expect((await processor.execute(actor,{...command,requestId:'after-draw',expectedRevision:1})).code).toBe('invalid_phase');
  expect(publicSnapshot((await store.load(record.matchId))!).terminalResult?.kind).toBe('draw');
});

test('ranked draws use a half-point Elo score, zero-sum deltas and no abandonment penalties', () => {
  const record: RankedRecord & LobbyRecord = {...createMatch('ranked-draw','ranked'),lobby:{inviteCode:'CODE',roomId:'room',owners:{}}};
  const accounts = {} as Record<Color,{accountId:string;rating:number}>;
  COLORS.forEach((color,i)=>{
    const accountId=`12345678-1234-4123-8123-${String(i).padStart(12,'0')}`;
    record.seats[color] = {...record.seats[color],ownerId:`owner-${color}`,controller:'human',connected:true};
    record.lobby.owners[`owner-${color}`]={credentialHash:`owner-${color}`,connectionId:color,accountId};
    accounts[color]={accountId,rating:1200};
  });
  record.phase='finished'; record.terminalResult={kind:'draw',winningTeam:null,reason:'bare_kings'};
  record.expiredDepartures=['R'];
  expect(buildRankedSettlement(record,accounts,1000).entries.map(entry=>entry.delta)).toEqual([0,0,0,0]);
  accounts.R.rating=1400; accounts.Y.rating=1800; accounts.B.rating=800; accounts.K.rating=1200;
  const plan=buildRankedSettlement(record,accounts,1000);
  expect(plan.entries.map(entry=>entry.delta)).toEqual([-15,15,-15,15]);
  expect(plan.kind).toBe('draw');
  expect(plan.offenders).toEqual([]);
  expect(plan.entries.every(entry=>entry.restrictionUntil===null)).toBe(true);
  record.terminalResult.winningTeam=1;
  expect(()=>buildRankedSettlement(record,accounts,1000)).toThrow('invalid_result');
});

test('rules v2 rejects old clients and recovery finishes a legacy bare-kings loop durably', async () => {
  const record: RecoveryRecord = {...createMatch('legacy-loop'),lobby:{inviteCode:'OLD',roomId:'old-room',owners:{}}};
  expect(record.rulesVersion).toBe('enochian-current-2');
  expect(parseCommand({requestId:'old',matchId:record.matchId,expectedRevision:0,protocolVersion:1,rulesVersion:'enochian-current-1',action:{type:'move',fr:2,fc:3,tr:2,tc:4}}).ok).toBe(false);
  record.rulesVersion='enochian-current-1'; record.phase='active';
  record.engine={board:{'2,3':{color:'Y',type:'KING'},'4,3':{color:'K',type:'KING'}},alive:{R:false,B:false,Y:true,K:true},turnIndex:2,over:false,moveCount:413};
  const store=new MemoryLobbyStore(); await store.create(record);
  const recovery=new RecoveryCoordinator({store,instanceId:'new',clock:()=>1000});
  const next=await recovery.claim(record.matchId,900,'new-room');
  expect(next.rulesVersion).toBe('enochian-current-2');
  expect(next.phase).toBe('finished'); expect(next.engine.over).toBe(true);
  expect(next.terminalResult).toEqual({kind:'draw',winningTeam:null,reason:'bare_kings'});
  expect(next.recoveryDeadline).toBeNull(); expect(next.recovery).toBeUndefined();
  expect((await store.load(record.matchId))?.terminalResult).toEqual(next.terminalResult);
});
