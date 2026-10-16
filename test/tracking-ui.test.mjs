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
