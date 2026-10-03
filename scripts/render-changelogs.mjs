import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const history=JSON.parse(readFileSync(resolve(root,'releases/changelog.json'),'utf8'));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const marker=(name,edge)=>`<!-- GAME_CHANGELOG_${name}_${edge} -->`;
const island=(name,body)=>`${marker(name,'BEGIN')}\n${body}\n${marker(name,'END')}\n`;
const styles=`<style>
.game-changelog{max-width:1040px;margin:0 auto;font-size:22px;line-height:1.5;overflow-wrap:anywhere}
.game-changelog .release-header{padding:24px;background:var(--panel);border:1px solid var(--gold);margin-bottom:24px}
.game-changelog h2{font-size:18px;line-height:1.8;color:var(--gold-bright);margin:0 0 16px}
.game-changelog .release-kicker{color:var(--gold-bright);margin:0 0 12px;font-size:12px;line-height:1.8}
.game-changelog .release-card{border:1px solid var(--gold);background:var(--panel);margin:0 0 16px;padding:18px 24px}
.game-changelog summary{cursor:pointer;color:var(--gold-bright)}
.game-changelog .release-title{font-size:13px;line-height:1.8}
.game-changelog .release-meta{display:block;font-size:20px;color:var(--parchment);margin-top:8px}
.game-changelog .release-notes{padding-left:24px;margin:20px 0}
.game-changelog li{margin:8px 0}
.game-changelog a{color:var(--gold-bright);text-decoration:underline;text-underline-offset:3px}
.game-changelog a:focus-visible,.game-changelog summary:focus-visible{outline:2px solid var(--gold-bright);outline-offset:5px}
.game-changelog .release-commits{border-top:1px solid var(--gold);padding-top:12px;font-size:19px}
.game-changelog .release-commits ul{padding-left:24px}
.game-changelog .release-type{display:inline-block;border:1px solid var(--gold);padding:0 8px;margin-right:10px;color:var(--gold-bright)}
@media(max-width:600px){.game-changelog .release-header,.game-changelog .release-card{padding:18px 16px}.game-changelog h2{font-size:14px}.game-changelog .release-title{font-size:11px}.game-changelog{font-size:21px}}
</style>`;

export function stripChangelog(source){
  for(const name of ['STYLES','NAV','CONTENT']){
    const begin=marker(name,'BEGIN'),end=marker(name,'END');
    const count=source.split(begin).length-1;
    assert.equal(count,source.split(end).length-1,'Changelog markers must pair');
    assert.ok(count<=1,'Changelog markers must be unique');
    if(!count)continue;
    const start=source.indexOf(begin),stop=source.indexOf(end);
    assert.ok(stop>start,'Changelog markers must be ordered');
    assert.equal(source[stop+end.length],'\n','Changelog owns only its following newline');
    const body=source.slice(start+begin.length,stop).trim();
    const after=source.slice(stop+end.length+1);
    if(name==='STYLES'){
      assert.ok(after.startsWith('</head>'),'Changelog styles remain at the end of the head');
      assert.equal(body,styles,'Changelog CSS is fixed and panel-scoped');
    }else if(name==='NAV'){
      assert.ok(after.startsWith('</nav>'),'Changelog button remains at the end of the original navigation');
      assert.equal(body,'<button class="tab-btn" data-tab="changelog">Changelog</button>');
    }else{
      assert.ok(after.startsWith('</main>'),'Changelog panel remains at the end of main');
      assert.match(body,/^<section class="tab-panel game-changelog" id="tab-changelog"/);
      assert.ok(body.endsWith('</section>'));
      assert.doesNotMatch(body,/<script|<style|\son\w+\s*=|javascript:/i,'Changelog content is static');
    }
    source=source.slice(0,start)+after;
  }
  return source;
}

function panel(game){
  const releases=history.releases.filter(r=>r.notes.some(n=>n.scope==='shared'||n.scope===game));
  return `<section class="tab-panel game-changelog" id="tab-changelog" aria-label="${game==='chaturaji'?'Chaturaji':'Enochian'} changelog">
  <header class="release-header">
    <p class="release-kicker pixel">ARCADE RELEASE ${escape(history.version)}</p>
    <h2 class="pixel">Changelog</h2>
    <p>What changed, who contributed, and when. ${game==='chaturaji'?'Chaturaji gameplay is unchanged; shared arcade updates are included here.':'Enochian updates and shared arcade improvements are collected here.'}</p>
    <p>Major versions change compatibility. Minor versions add features. Patches fix or refine what is already here.</p>
    <p>Earlier versions are reconstructed from git history, rather than previously published release tags. Both games share the arcade version.</p>
    <a href="${history.repository}/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Read the full project changelog</a>
  </header>
${releases.map((r,i)=>`  <details class="release-card"${i===0?' open':''}>
    <summary><span class="release-title pixel">v${escape(r.version)} · ${escape(r.title)}</span><span class="release-meta"><span class="release-type">${escape(r.type)}</span><time datetime="${r.date}">${r.date}</time>${r.reconstructed?' · reconstructed':''}</span></summary>
    <ul class="release-notes">${r.notes.filter(n=>n.scope==='shared'||n.scope===game).map(n=>`<li>${escape(n.text)}</li>`).join('\n')}</ul>
${r.commits.length?`    <details class="release-commits"><summary>Project release contributors &amp; commits (${r.commits.length})</summary><ul>${r.commits.map(c=>`<li><a href="${history.repository}/commit/${c.hash}" target="_blank" rel="noopener noreferrer">${c.hash.slice(0,7)}</a> · ${escape(c.author)} · ${escape(c.subject)}</li>`).join('\n')}</ul></details>`:''}
  </details>`).join('\n')}
</section>`;
}

export function renderGameChangelog(game,source){
  source=stripChangelog(source);
  assert.ok(['chaturaji','enochian'].includes(game));
  return source.replace('</head>',island('STYLES',styles)+'</head>')
    .replace('</nav>',island('NAV','<button class="tab-btn" data-tab="changelog">Changelog</button>')+'</nav>')
    .replace('</main>',island('CONTENT',panel(game))+'</main>');
}

function markdown(){
  return `# Chess Eternal changelog\n\nCurrent arcade version: **${history.version}**. Both games share this version.\n\n${history.policy}\n\nHistory reviewed through [${history.historyThrough.slice(0,7)}](${history.repository}/commit/${history.historyThrough}). Contributors are credited using the author names recorded in git; this does not infer who operated a coding assistant.\n\n`+history.releases.map(r=>`## ${r.version} — ${r.title} (${r.date})\n\n${r.type.toUpperCase()}${r.reconstructed?' · reconstructed historical release':''}\n\n${r.notes.map(n=>`- **${n.scope==='shared'?'Shared arcade':n.scope==='enochian'?'Enochian':'Chaturaji'}:** ${n.text}`).join('\n')}\n\n${r.commits.length?'Commits and contributors:\n\n'+r.commits.map(c=>`- [${c.hash.slice(0,7)}](${history.repository}/commit/${c.hash}) — ${c.author}: ${c.subject}`).join('\n')+'\n\n':''}`).join('');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(readFileSync(resolve(root,'VERSION'),'utf8').trim(),history.version);
  const check=process.argv.includes('--check');
  for(const game of ['chaturaji','enochian']){
    const file=resolve(root,`${game}.html`),source=readFileSync(file,'utf8'),next=renderGameChangelog(game,source);
    if(check)assert.equal(source,next,`${game} changelog must match the manifest`);else writeFileSync(file,next);
  }
  const file=resolve(root,'CHANGELOG.md'),next=markdown().trimEnd()+'\n';
  if(check)assert.equal(readFileSync(file,'utf8'),next,'Markdown changelog must match the manifest');else writeFileSync(file,next);
  console.log(`Changelogs ${check?'verified':'rendered'} for arcade v${history.version}.`);
}
