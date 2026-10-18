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

test('login "Esqueceu?" opens the password recovery flow (WhatsApp code + new password)', async () => {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  const app = await readFile(new URL('public/js/app.js', root), 'utf8');
  const api = await readFile(new URL('public/js/api.js', root), 'utf8');

  assert.match(html, /id="forgot-link"[^>]*openForgotPassword\(\)/);
  assert.match(html, /id="view-forgot-password"/);
  assert.match(html, /id="form-forgot-request"/);
  assert.match(html, /id="form-forgot-reset"/);
  assert.match(html, /id="forgot-input-code"/);
  assert.match(app, /window\.openForgotPassword = openForgotPassword/);
  assert.match(api, /\/auth\/forgot-password/);
  assert.match(api, /\/auth\/reset-password/);
});
