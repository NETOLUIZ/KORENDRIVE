import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCompanyPayload } from '../server/routes/superadmin.js';

const base = {
  company: { name: 'Koren Transportes', cnpj: '', phone: '11999999999', email: 'empresa@koren.app', address: 'Rua A, 10', plan: 'Profissional', monthly_fee: 149.9 },
  admin: { name: 'Ana Admin', email: 'ana@koren.app', password: 'senha-segura' }
};

test('validateCompanyPayload accepts optional CNPJ and normalizes it to null', () => {
  const result = validateCompanyPayload(base);
  assert.deepEqual(result, { ok: true, value: { ...base, company: { ...base.company, cnpj: null, monthly_fee: 149.9 } } });
});

test('validateCompanyPayload rejects incomplete data and invalid CNPJ', () => {
  assert.equal(validateCompanyPayload({ ...base, company: { ...base.company, name: '' } }).ok, false);
  assert.equal(validateCompanyPayload({ ...base, company: { ...base.company, cnpj: '123' } }).ok, false);
});
