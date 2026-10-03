import {expect,test} from 'bun:test';
import type {Pool} from 'pg';
import {createMatch,COLORS} from '../src/domain/match.js';
import type {LobbyRecord} from '../src/storage/LobbyStore.js';
import {PostgresRankedSettlement,type RankedSettlement} from '../src/storage/PostgresRankedSettlement.js';

test('durable ranked draw settlement writes draw classification and releases admission once',async()=>{
  const record:LobbyRecord={...createMatch('durable-draw','ranked'),lobby:{inviteCode:'CODE',roomId:'room',owners:{}}};
  const ratings: Array<{account_id:string;rating:number}>=[];
  COLORS.forEach((color,i)=>{
    const id=`12345678-1234-4123-8123-${String(i).padStart(12,'0')}`;
    record.seats[color]={...record.seats[color],ownerId:`owner-${color}`,controller:'human',connected:true};
    record.lobby.owners[`owner-${color}`]={credentialHash:`owner-${color}`,connectionId:color,accountId:id};
    ratings.push({account_id:id,rating:1200});
  });
  record.phase='finished';record.terminalResult={kind:'draw',winningTeam:null,reason:'stalemate'};
  let settlement:RankedSettlement|null=null,deleted=0,insertedKind:unknown;
  const client={async query(sql:string,values:unknown[]=[]){
    if(sql.includes('SELECT record'))return{rowCount:1,rows:[{record}]};
    if(sql.includes('SELECT details'))return{rowCount:settlement?1:0,rows:settlement?[{details:settlement}]:[]};
    if(sql.includes('SELECT account_id'))return{rowCount:4,rows:ratings};
    if(sql.includes('INSERT INTO')&&sql.includes('.settlements(')){insertedKind=values[2];settlement=JSON.parse(String(values[4]));}
    if(sql.includes('DELETE FROM')&&sql.includes('admission_locks'))deleted++;
    return{rowCount:1,rows:[]};
  },release(){}};
  const store=new PostgresRankedSettlement({connect:async()=>client} as unknown as Pool,{schema:'enochian_draw_test'});
  const first=await store.settle(record.matchId,1000);
  expect(first?.kind).toBe('draw');expect(insertedKind).toBe('draw');
  expect(first?.entries.map(entry=>entry.delta)).toEqual([0,0,0,0]);
  expect(await store.settle(record.matchId,2000)).toEqual(first);
  expect(deleted).toBe(1);
});
