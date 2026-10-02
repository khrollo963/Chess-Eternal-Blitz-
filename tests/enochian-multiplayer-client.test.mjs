import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const html=readFileSync(new URL('../enochian.html',import.meta.url),'utf8');
const script=html.match(/<script id="enochian-multiplayer-client">([\s\S]*?)<\/script>/)[1];
function load(){const context=vm.createContext({URL,Map,AbortController});vm.runInContext(script,context);return context.EnochianMultiplayerCore;}
function state(revision=1,phase='lobby'){
  return {matchId:'match',revision,protocolVersion:1,rulesVersion:'enochian-current-1',mode:'casual',phase,turn:'R',moveCount:0,board:{'6,7':{color:'R',type:'PAWN_ROOK'}},alive:{R:true,B:true,Y:true,K:true},seats:Object.fromEntries(['R','B','Y','K'].map(color=>[color,{color,displayName:color==='R'?'Alice':'',controller:color==='R'?'human':'bot',connected:color==='R',ready:false,disconnectDeadline:null}])),lobbyDeadline:1800000,recoveryDeadline:null,terminalResult:null,exchangeOffer:null};
}
function signal(){const listeners=[];const register=fn=>{listeners.push(fn);return()=>{const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);};};register.emit=value=>listeners.slice().forEach(fn=>fn(value));register.clear=()=>{listeners.length=0;};return register;}
function fixture({fetch:customFetch,initial=state(),join:customJoin}={}){
  const coreLibrary=load(),requests=[],rooms=[],statuses=[],paints=[],changes=[],timers=new Map();let timerId=0;
  const makeRoom=()=>{const ack=signal(),room={state:initial,reconnection:{enabled:true},onStateChange:signal(),onLeave:signal(),onDrop:signal(),onError:signal(),sent:[],leaves:[],onMessage:(type,fn)=>{assert.equal(type,'ack');return ack(fn);},ack:value=>ack.emit(value),send(type,payload){this.sent.push({type,payload});},leave(consented=true){this.leaves.push(consented);return Promise.resolve();},connection:{close(){}},removeAllListeners(){this.onStateChange.clear();this.onLeave.clear();this.onDrop.clear();ack.clear();}};rooms.push(room);return room;};
  const core=coreLibrary.create({endpoint:'http://127.0.0.1:2567',fetch:async(url,init)=>{requests.push({url,init,body:init.body&&JSON.parse(init.body)});return customFetch?customFetch(url,init):{ok:true,json:async()=>({matchId:'match',code:'PUBLIC',credential:'PRIVATE-SEAT',roomId:'transport'})};},client:()=>({joinById:async(id,options)=>{requests.push({roomId:id,options});return customJoin?customJoin(makeRoom):makeRoom();}}),setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),randomId:()=>String(timerId),onStatus:text=>statuses.push(text),onChange:view=>changes.push(view),onSnapshot:(snapshot,color)=>paints.push({snapshot,color})});
  return {core,rooms,requests,statuses,paints,changes,timers,makeRoom,lib:coreLibrary};
}

test('Task12 insertion blocks leave protected original source and canonical engine byte-identical',()=>{
  const strip=source=>source.replace(/<!-- (ENOCHIAN_MULTIPLAYER_UI|ENOCHIAN_MULTIPLAYER_CONTROLS|ENOCHIAN_CLIENT_SDKS|ENOCHIAN_MULTIPLAYER_CLIENT)_BEGIN -->[\s\S]*?<!-- \1_END -->\r?\n?/g,'');
  const committed=execFileSync('git',['show','HEAD:enochian.html'],{encoding:'utf8',maxBuffer:10*1024*1024});
  assert.equal(strip(html),strip(committed));
  const engine=source=>source.match(/\/\/ ENOCHIAN_ENGINE_START([\s\S]*?)\/\/ ENOCHIAN_ENGINE_END/)[1];
  assert.equal(createHash('sha256').update(engine(html)).digest('hex'),createHash('sha256').update(engine(committed)).digest('hex'));
});

test('official embedded SDKs are deterministic, pinned and fully licensed without external scripts',()=>{
  execFileSync(process.execPath,['scripts/embed-client-sdks.mjs','--check'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.match(html,/@colyseus\/sdk@0\.18\.4; source SHA-256 [a-f0-9]{64}/);
  assert.match(html,/@supabase\/supabase-js@2\.117\.2; source SHA-256 [a-f0-9]{64}/);
  assert.doesNotMatch(html,/<script[^>]+src=/i);
  const licenses=JSON.parse(html.match(/id="enochian-sdk-licenses">([\s\S]*?)<\/script>/)[1]);
  assert.match(licenses.licenses,/Permission is hereby granted/);
  const context=vm.createContext({URL,AbortController,Headers,FormData,Request,Response,TextEncoder,TextDecoder,fetch,setTimeout,clearTimeout,crypto:webcrypto,console});
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
    if(match[1].includes('application/json'))continue;
    const compiled=new vm.Script(match[2]);
    if(match[1].includes('data-enochian-vendor'))compiled.runInContext(context);
  }
  assert.equal(typeof context.Colyseus.Client,'function');assert.equal(typeof context.supabase.createClient,'function');
});

test('public projection parses synchronized Schema and drops all private/unknown identity fields',()=>{
  const f=fixture(),input=state();input.credential='secret';input.lobby={owners:{secret:true}};input.seats.R.ownerId='private-owner';input.alive={R:{alive:true},B:{alive:true},Y:{alive:true},K:{alive:true}};
  input.seats.R.exchangeCounterpart='B';
  const projected=f.lib.projection(input);
  assert.equal(projected.exchangeAvailable.R,'B');assert.equal(projected.alive.R,true);
  assert.doesNotMatch(JSON.stringify(projected),/secret|private-owner|credential|owners/);
  assert.throws(()=>f.lib.projection({...input,protocolVersion:0}),/incompatible_state/);
  assert.throws(()=>f.lib.projection({...input,board:{'99,99':{color:'R',type:'KING'}}}),/incompatible_state/);
});

test('move sends an intent without optimistic board mutation and applies monotonic confirmed revisions',async()=>{
  const f=fixture({initial:state(1,'active')});await f.core.create({mode:'casual',name:'Alice',color:'R'});
  const room=f.rooms[0],before=JSON.stringify(f.core.view().snapshot.board);
  assert.equal(f.core.send('command',{type:'move',fr:6,fc:7,tr:5,tc:7}),true);
  assert.equal(JSON.stringify(f.core.view().snapshot.board),before);assert.equal(f.core.send('command',{type:'move',fr:6,fc:7,tr:5,tc:7}),false);
  const sent=room.sent[0];assert.equal(sent.payload.expectedRevision,1);assert.equal(sent.payload.protocolVersion,1);assert.equal(Object.keys(sent.payload).length,6);
  const confirmed=state(2,'active');confirmed.board={'5,7':{color:'R',type:'PAWN_ROOK'}};confirmed.moveCount=1;
  room.ack({ok:true,code:'accepted',requestId:sent.payload.requestId,snapshot:confirmed});
  assert.equal(f.core.view().snapshot.moveCount,1);assert.equal(f.core.view().pending,null);
  room.onStateChange.emit(state(1,'active'));assert.equal(f.core.view().snapshot.revision,2);
});

test('rejection clears matching pending command and never changes committed state',async()=>{
  const f=fixture({initial:state(1,'active')});await f.core.create({mode:'casual',name:'Alice',color:'R'});
  f.core.send('command',{type:'move',fr:6,fc:7,tr:5,tc:7});const before=JSON.stringify(f.core.view().snapshot);
  f.rooms[0].ack({ok:false,code:'stale_revision',retryable:true,requestId:f.rooms[0].sent[0].payload.requestId});
  assert.equal(f.core.view().pending,null);assert.equal(JSON.stringify(f.core.view().snapshot),before);assert.match(f.statuses.at(-1),/Try again/);
});

test('accepted color acknowledgement updates own seat even if Schema patch already arrived',async()=>{
  const f=fixture();await f.core.create({mode:'casual',name:'Alice',color:'R'});
  f.core.send('lobby_command',{type:'color',color:'B'});const moved=state(2);moved.seats.B={...moved.seats.R,color:'B'};moved.seats.R={...moved.seats.Y,color:'R'};
  f.rooms[0].onStateChange.emit(moved);f.rooms[0].ack({ok:true,requestId:f.rooms[0].sent[0].payload.requestId,snapshot:moved});
  assert.equal(f.core.view().ownColor,'B');assert.equal(f.paints.at(-1).color,'B');
});

test('old asynchronous joins and callbacks cannot replace a new session or survive exit',async()=>{
  let complete;const f=fixture({join:makeRoom=>new Promise(resolve=>{complete=()=>resolve(makeRoom());})});
  const entering=f.core.create({mode:'casual',name:'Alice',color:'R'});await new Promise(resolve=>setImmediate(resolve));
  await f.core.leave();complete();assert.equal(await entering,false);assert.equal(f.core.view().joined,false);assert.equal(f.rooms[0].leaves.length,1);
  const g=fixture();await g.core.create({mode:'casual',name:'Alice',color:'R'});const old=g.rooms[0];await g.core.leave();old.onStateChange.emit(state(10,'active'));assert.equal(g.core.view().snapshot,null);
});

test('recover uses original private credential and current transport mapping; public invitation excludes it',async()=>{
  const f=fixture();await f.core.create({mode:'casual',name:'Alice',color:'R'});
  assert.equal(JSON.stringify(f.core.invite()),JSON.stringify({code:'PUBLIC'}));assert.doesNotMatch(JSON.stringify(f.core.view()),/PRIVATE-SEAT/);
  f.rooms[0].onDrop.emit();assert.equal(f.core.view().connected,false);assert.equal(await f.core.recover(),true);
  const request=f.requests.find(r=>r.url?.endsWith('/invitations/recover'));assert.deepEqual(request.body,{matchId:'match',credential:'PRIVATE-SEAT'});
  assert.equal(f.requests.filter(r=>r.roomId).at(-1).options.credential,'PRIVATE-SEAT');
});

test('authenticated recovery color repairs a lost color-change acknowledgement',async()=>{
  let recovering=false;
  const f=fixture({fetch:async()=>({ok:true,json:async()=>recovering?{matchId:'match',roomId:'new-transport',color:'B'}:{matchId:'match',code:'PUBLIC',credential:'PRIVATE-SEAT',roomId:'transport',color:'R'}})});
  await f.core.create({mode:'casual',name:'Alice',color:'R'});recovering=true;
  assert.equal(await f.core.recover(),true);assert.equal(f.core.view().ownColor,'B');assert.equal(f.requests.filter(r=>r.roomId).at(-1).roomId,'new-transport');
});

test('terminal HTTP recovery shows final result without joining or reopening play',async()=>{
  let terminal=false;const final=state(3,'void');final.terminalResult={kind:'void',winningTeam:null,reason:'abandonment'};
  const f=fixture({fetch:async()=>({ok:true,json:async()=>terminal?{snapshot:final}:{matchId:'match',code:'PUBLIC',credential:'PRIVATE-SEAT',roomId:'transport'}})});
  await f.core.create({mode:'casual',name:'Alice',color:'R'});terminal=true;assert.equal(await f.core.recover(),true);
  assert.equal(f.rooms.length,1);assert.equal(f.core.view().snapshot.phase,'void');assert.equal(f.core.send('command',{type:'move',fr:6,fc:7,tr:5,tc:7}),false);
});

test('paused and disconnected states gate intent commands, and delayed acks require recovery',async()=>{
  const f=fixture({initial:state(1,'paused')});await f.core.create({mode:'casual',name:'Alice',color:'R'});
  assert.equal(f.core.send('command',{type:'move',fr:6,fc:7,tr:5,tc:7}),false);assert.equal(f.core.send('exchange_command',{type:'offer',counterpart:'B'}),false);
  f.rooms[0].onStateChange.emit(state(2,'active'));f.core.send('command',{type:'move',fr:6,fc:7,tr:5,tc:7});
  [...f.timers.values()].find(timer=>timer.ms===8000).fn();assert.equal(f.core.view().connected,false);assert.equal(f.core.view().pending,null);
});

test('authorization is private POST/socket data and safe endpoint configuration rejects remote plaintext',async()=>{
  const f=fixture();f.core.setAuthorization('Bearer signed.token.value');await f.core.create({mode:'ranked',name:'Alice',color:'R'});
  assert.equal(f.requests[0].init.headers.Authorization,'Bearer signed.token.value');assert.equal(f.requests.find(r=>r.roomId).options.authorization,'Bearer signed.token.value');
  assert.doesNotMatch(JSON.stringify(f.core.view()),/signed.token/);assert.throws(()=>f.lib.endpoint('http://remote.example'),/invalid_endpoint/);assert.throws(()=>f.lib.endpoint('https://user:secret@example.com'),/invalid_endpoint/);
});

test('Open sign-in posts an empty object to the handoff route before opening its return page',async()=>{
  // Execute the actual button handler; the core's HTTP method comes from its body argument.
  const f=fixture({fetch:async()=>({ok:true,json:async()=>({handoffId:'HANDOFF',completionSecret:'PRIVATE',pollSecret:'POLL',expiresAt:300000})})});
  const handler=script.match(/byId\('mpSignIn'\)\.onclick=async\(\)=>\{([\s\S]*?)\n      \};/)[1];
  const elements=new Map(),popup={opener:{},location:'about:blank',close(){this.closed=true;}},consumed=[];
  const context=vm.createContext({core:f.core,authGeneration:0,authTimer:null,handoff:null,encodeURIComponent,clearTimeout,window:{open:()=>popup},byId:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},consumeHandoff:()=>consumed.push(true)});
  await vm.runInContext(`(async()=>{${handler}})()`,context);
  assert.equal(f.requests[0].url,'http://127.0.0.1:2567/identity/handoffs');
  assert.equal(f.requests[0].init.method,'POST');assert.deepEqual(f.requests[0].body,{});
  assert.equal(popup.location,'http://127.0.0.1:2567/signin#handoff=HANDOFF&complete=PRIVATE');
  assert.equal(popup.opener,null);assert.equal(elements.get('mpSignInLink').hidden,false);assert.equal(consumed.length,1);
});

test('unavailable backend fails predictably and retains independent local-play functions',async()=>{
  const f=fixture({fetch:async()=>{throw new Error('private-backend-error');}});
  assert.equal(await f.core.create({mode:'casual',name:'Alice',color:'R'}),false);assert.equal(f.core.view().joined,false);assert.match(f.statuses.at(-1),/Local play remains available/);assert.doesNotMatch(f.statuses.join(' '),/private-backend-error/);
  assert.match(script,/if\(!online\)return originals\.makeMove/);assert.match(script,/localCpu\.menu\(\)/);
});
