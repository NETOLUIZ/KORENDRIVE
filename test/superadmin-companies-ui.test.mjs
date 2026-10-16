import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('superadmin client exposes company management requests', async () => {
  const source = await readFile(new URL('public/js/superadmin-api.js', root), 'utf8');
  for (const method of ['listCompanies', 'createCompany', 'getCompany', 'updateCompany', 'setCompanyStatus']) {
    assert.match(source, new RegExp(`async ${method}\\(`));
  }
});
