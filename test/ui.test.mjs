import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('login provides a prominent full-width registration call to action', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');

  assert.match(html, /id="register-cta"/);
  assert.match(html, /onclick="navigateTo\('register-step1'\)"/);
  assert.match(html, /Criar minha conta/);
  assert.match(html, /w-full[^\"]*bg-brand/);
});
