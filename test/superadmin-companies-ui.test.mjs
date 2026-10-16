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

test('superadmin has a Companies page with registration form and table', async () => {
  const html = await readFile(new URL('public/superadmin.html', root), 'utf8');
  for (const id of ['page-empresas', 'form-company', 'companies-table-body', 'modal-company-detail']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
