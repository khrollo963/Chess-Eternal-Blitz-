import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { BunWebSockets } from '@colyseus/bun-websockets';
import { AuthHandoff, HandoffError } from '../identity/AuthHandoff.js';
import { readSupabaseIdentityConfig, type SupabaseIdentityConfig } from '../identity/supabase.js';
import type { VerifiedAuth } from '../storage/LobbyStore.js';

type App = ReturnType<BunWebSockets['getExpressApp']>;
export type SignInProvider = 'email' | 'google' | 'github' | 'apple' | 'discord' | 'azure';
const supported: readonly string[] = ['email', 'google', 'github', 'apple', 'discord', 'azure'];
let bundle: string | undefined;
function sdkBundle(): string {
  if (bundle !== undefined) return bundle;
  const require = createRequire(import.meta.url);
  let packagePath: string;
  try { packagePath = require.resolve('@supabase/supabase-js/package.json'); }
  catch { packagePath = resolve(dirname(require.resolve('@supabase/supabase-js')), '..', 'package.json'); }
  const root = dirname(packagePath), metadata = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (metadata.version !== '2.117.2') throw new Error('identity_configuration_invalid');
  const license = readFileSync(resolve(root, 'LICENSE'), 'utf8').replaceAll('*/', '* /');
  const source = readFileSync(resolve(root, 'dist/umd/supabase.js'), 'utf8').replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, '').replace(/<\/script/gi, '<\\/script');
  bundle = `/* Supabase JS ${metadata.version}\n${license}\n*/\n${source}`;
  return bundle;
}
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function page(config: SupabaseIdentityConfig, providers: readonly string[], nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign in · Enochian Chess</title>
<style nonce="${nonce}">:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#11181b;color:#f2ece0}body{margin:0;padding:36px 20px}main{max-width:440px;margin:6vh auto}h1{font-size:30px;margin:0 0 12px}p{line-height:1.6;color:#c7c6bf}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:13px;border-radius:8px;border:1px solid #59635c}input{background:#1b2528;color:inherit}button{margin-top:12px;background:#dec68a;color:#172022;cursor:pointer;font-weight:650}button:disabled{opacity:.55;cursor:wait}#returnCode{font-family:monospace;text-align:center;font-size:20px}#status{min-height:50px}[hidden]{display:none!important}#social button{background:#233239;color:#f2ece0}a{color:#dec68a}</style>
</head><body><main><h1>Sign in</h1><p>Use your account for ranked chess. Your casual game remains available without signing in.</p>
<section id="emailPanel"><form id="emailForm"><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required maxlength="254"><button id="send" type="submit">Send sign-in code</button></form>
<form id="codeForm" hidden><label for="code">Code from your email</label><input id="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="12"><button id="verify" type="submit">Sign in with code</button></form></section>
<section id="social"></section><p id="status" role="status" aria-live="polite">Preparing sign-in…</p>
<section id="done" hidden><h2>You're signed in</h2><p>Return to your game. If it asks for a return code, copy this code:</p><input id="returnCode" readonly aria-label="Return code"><button id="copy" type="button">Copy return code</button></section>
<p id="restart" hidden>Open a new sign-in window from your game to try again.</p></main>
<script nonce="${nonce}">${sdkBundle()}</script><script nonce="${nonce}">
'use strict';
const config=${json(config)}, providers=${json(providers)};
const el=id=>document.getElementById(id), status=message=>{el('status').textContent=message;};
const bindingKey='enochian-signin-handoff', memory=new Map();
const storage={getItem(key){try{return sessionStorage.getItem(key)??memory.get(key)??null;}catch{return memory.get(key)??null;}},setItem(key,value){memory.set(key,value);try{sessionStorage.setItem(key,value);}catch{}},removeItem(key){memory.delete(key);try{sessionStorage.removeItem(key);}catch{}}};
const validSecret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
let binding=null, persistentBinding=false, client=null, completing=false;
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('handoff')||fragment.has('complete')){
 const handoffId=fragment.get('handoff'),completionSecret=fragment.get('complete');
 // Clear ephemeral secrets before any requests or provider navigation.
 history.replaceState(null,'',location.pathname+location.search);
 if(validSecret(handoffId)&&validSecret(completionSecret)){binding={handoffId,completionSecret};storage.setItem(bindingKey,JSON.stringify(binding));}
}else{try{binding=JSON.parse(storage.getItem(bindingKey)||'null');}catch{}}
if(binding&&!validSecret(binding.handoffId)||binding&&!validSecret(binding.completionSecret))binding=null;
try{persistentBinding=!!binding&&sessionStorage.getItem(bindingKey)===JSON.stringify(binding);}catch{}
async function complete(session){
 if(!session||!binding||completing)return;
 completing=true;status('Checking your sign-in…');
 try{
  const response=await fetch('/identity/handoffs/complete',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(binding)});
  if(!response.ok)throw new Error();
  const result=await response.json();if(!/^[A-Za-z0-9_-]{22}$/.test(result.returnCode))throw new Error();
  storage.removeItem(bindingKey);binding=null;el('emailPanel').hidden=true;el('social').hidden=true;el('done').hidden=false;el('returnCode').value=result.returnCode;status('You can return to your game.');
 }catch{status('Sign-in could not be returned to your game.');el('restart').hidden=false;}
}
el('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(el('returnCode').value);status('Return code copied.');}catch{el('returnCode').focus();el('returnCode').select();status('Select and copy the return code.');}});
el('emailForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!client||!binding)return;el('send').disabled=true;
 try{const {error}=await client.auth.signInWithOtp({email:el('email').value.trim(),options:{emailRedirectTo:location.origin+'/signin'}});if(error)throw new Error();el('codeForm').hidden=false;status('Check your email for a sign-in code.');el('code').focus();}catch{status('We could not send a code. Check your email address and try again.');}finally{el('send').disabled=false;}
});
el('codeForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!client||!binding)return;el('verify').disabled=true;
 try{const {data,error}=await client.auth.verifyOtp({email:el('email').value.trim(),token:el('code').value.trim(),type:'email'});if(error||!data.session)throw new Error();await complete(data.session);}catch{status('That code could not be verified. Try again or request a new code.');}finally{el('verify').disabled=false;}
});
async function start(){
 if(window.top!==window.self||!binding){status('Open sign-in from your game.');el('emailPanel').hidden=true;el('restart').hidden=false;return;}
 client=supabase.createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',persistSession:true,storage,autoRefreshToken:true,detectSessionInUrl:true}});
 el('emailPanel').hidden=!providers.includes('email');
 for(const provider of providers.filter(value=>value!=='email')){
  const button=document.createElement('button');button.type='button';button.textContent='Continue with '+({google:'Google',github:'GitHub',apple:'Apple',discord:'Discord',azure:'Microsoft'}[provider]||provider);button.disabled=!persistentBinding;
  button.addEventListener('click',async()=>{if(!binding||!persistentBinding)return;button.disabled=true;try{const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+'/signin'}});if(error)throw new Error();}catch{status('That sign-in option is unavailable. Try email or open a new sign-in window.');button.disabled=false;}});el('social').appendChild(button);
 }
 try{const {data,error}=await client.auth.getSession();history.replaceState(null,'',location.pathname);if(error)throw new Error();if(data.session)await complete(data.session);else status('Choose how you would like to sign in.');}catch{status('Choose how you would like to sign in.');}
}
void start();
</script></body></html>`;
}

export function registerSignIn(app: App, options: {
  identityConfig?: SupabaseIdentityConfig;
  verifyAuth?: (authorization: string | undefined) => Promise<VerifiedAuth | undefined>;
  clock?: () => number; providers?: readonly SignInProvider[];
}) {
  const config = options.identityConfig ? readSupabaseIdentityConfig({ SUPABASE_URL: options.identityConfig.url, SUPABASE_PUBLISHABLE_KEY: options.identityConfig.publishableKey }) : undefined;
  const providers = [...new Set(options.providers ?? ['email'])];
  if (!providers.length || providers.some(provider => !supported.includes(provider))) throw new Error('identity_configuration_invalid');
  const handoffs = config && options.verifyAuth ? new AuthHandoff({ verifyAuth: options.verifyAuth, clock: options.clock }) : undefined;
  const parse = (body: unknown, keys: string[], optional: string[] = []) => {
    if (typeof body !== 'string' || Buffer.byteLength(body) > 1024) throw new HandoffError('unauthorized');
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !(key in value)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) throw new HandoffError('unauthorized');
    return value as Record<string, unknown>;
  };
  const noStore = (res: { setHeader(name: string, value: string): unknown }) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); };
  for (const path of ['/identity/handoffs', '/identity/handoffs/complete', '/identity/handoffs/consume']) app.post(path, async (req, res) => {
    noStore(res);
    if (!handoffs) { res.status(503).json({ code: 'identity_unavailable' }); return; }
    try {
      if (path === '/identity/handoffs') { if (req.body !== undefined && req.body !== null && req.body !== '') parse(req.body, []); res.status(201).json(handoffs.create()); }
      else if (path.endsWith('/complete')) { const data = parse(req.body, ['handoffId', 'completionSecret']); res.json(await handoffs.complete(data.handoffId, data.completionSecret, req.headers.authorization)); }
      else { const data = parse(req.body, ['handoffId', 'pollSecret'], ['returnCode']); const result = handoffs.consume(data.handoffId, data.pollSecret, data.returnCode); res.status('pending' in result ? 202 : 200).json(result); }
    } catch (error) {
      const code = error instanceof HandoffError ? error.code : 'unauthorized';
      res.status(code === 'handoff_capacity' ? 429 : code === 'handoff_expired' ? 410 : code === 'handoff_completed' ? 409 : 401).json({ code });
    }
  });
  app.get('/signin', (_req, res) => {
    noStore(res); res.setHeader('X-Frame-Options', 'DENY');
    if (!config || !handoffs) { res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); res.status(503).json({ code: 'identity_unavailable' }); return; }
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self' ${config.url}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`);
    try { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(page(config, providers, nonce)); }
    catch { res.status(503).json({ code: 'identity_unavailable' }); }
  });
  return { handoffs };
}
