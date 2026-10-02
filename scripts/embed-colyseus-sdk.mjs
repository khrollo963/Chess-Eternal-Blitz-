import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SDK_VERSION = '0.18.4';
export const SDK_BEGIN = '<!-- BEGIN GENERATED COLYSEUS SDK -->';
export const SDK_END = '<!-- END GENERATED COLYSEUS SDK -->';
const pagePath = fileURLToPath(new URL('../enochian.html', import.meta.url));

export function buildSdkBlock() {
  const vendor = new URL('../server/node_modules/@colyseus/sdk/', import.meta.url);
  const metadata = JSON.parse(readFileSync(new URL('package.json', vendor), 'utf8'));
  if (metadata.version !== SDK_VERSION) throw new Error(`SDK ${SDK_VERSION} required`);
  const bundle = readFileSync(new URL('dist/colyseus.js', vendor), 'utf8');
  const license = readFileSync(new URL('LICENSE', vendor), 'utf8');
  const digest = createHash('sha256').update(bundle).digest('hex');
  // Safe inside an HTML script, retaining the original distribution license.
  const safeBundle = bundle.replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/gm, '');
  const safeLicense = license.replace(/\*\//g, '* /');
  return `${SDK_BEGIN}\n<script>\n/* @colyseus/sdk ${SDK_VERSION}; original bundle SHA-256 ${digest}\n${safeLicense}\n*/\n${safeBundle}\n</script>\n${SDK_END}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = readFileSync(pagePath, 'utf8');
  const start = page.indexOf(SDK_BEGIN);
  const end = page.indexOf(SDK_END);
  if (start < 0 || end < start) throw new Error('SDK markers must be added by the authorized client integration task first.');
  const block = buildSdkBlock();
  const output = page.slice(0, start) + block + page.slice(end + SDK_END.length);
  if (process.argv.includes('--check')) {
    if (output !== page) throw new Error('Embedded SDK is stale');
    console.info(`Embedded SDK ${SDK_VERSION} is current`);
  } else { writeFileSync(pagePath, output); }
}
