import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('public tracking page polls a token and renders a map', async () => {
  const html = await readFile(new URL('public/tracking.html', root), 'utf8');
  assert.match(html, /id="tracking-map"/);
  assert.match(html, /startTracking/);
  assert.match(html, /5000/);
});

test('public tracking page handles the full ride lifecycle', async () => {
  const html = await readFile(new URL('public/tracking.html', root), 'utf8');
  assert.match(html, /requested:/);
  assert.match(html, /'completed' \|\| data\.status === 'cancelled'/);
  assert.match(html, /view-invalid/);
  assert.match(html, /view-ended/);
});

test('public tracking page loads MapLibre as an ES module (no dead UMD build)', async () => {
  const html = await readFile(new URL('public/tracking.html', root), 'utf8');
  assert.match(html, /<script type="module">/);
  assert.match(html, /import \* as maplibregl from/);
  assert.doesNotMatch(html, /<script src="[^"]*maplibre-gl\.js">/);
});

test('public tracking page centers the invalid/ended state icon with its text', async () => {
  const html = await readFile(new URL('public/tracking.html', root), 'utf8');
  assert.match(html, /id="view-invalid" class="hidden flex flex-col/);
  assert.match(html, /id="view-ended" class="hidden flex flex-col/);
});
