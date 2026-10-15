import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('cockpit radar uses a Leaflet map container instead of an embedded Google map', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');

  assert.match(html, /leaflet@1\.9\.4/);
  assert.match(html, /id="demand-map"/);
  assert.doesNotMatch(html, /id="demand-map-frame"/);
  assert.doesNotMatch(html, /google\.com\/maps/);
});

test('demand map keeps the browser GPS flow and offers a recenter control', async () => {
  const script = await readFile(new URL('public/js/app.js', root), 'utf8');

  assert.match(script, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(script, /L\.map\('demand-map'/);
  assert.match(script, /recenterDemandMap/);
});

test('login provides a prominent full-width registration call to action', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');

  assert.match(html, /id="register-cta"/);
  assert.match(html, /onclick="navigateTo\('register-step1'\)"/);
  assert.match(html, /Criar minha conta/);
  assert.match(html, /w-full[^\"]*bg-brand/);
});
