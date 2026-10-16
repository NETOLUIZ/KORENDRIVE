import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('schema defines an optional-CNPJ company with one responsible admin', async () => {
  const schema = await readFile(new URL('server/schema.sql', root), 'utf8');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS companies/i);
  assert.match(schema, /cnpj\s+TEXT(?!\s+NOT NULL)/i);
  assert.match(schema, /admin_id\s+INTEGER\s+NOT NULL\s+UNIQUE\s+REFERENCES admins\(id\)/i);
  assert.match(schema, /monthly_fee\s+NUMERIC\(10,2\)\s+NOT NULL/i);
  assert.match(schema, /status\s+TEXT\s+NOT NULL\s+DEFAULT 'active'\s+CHECK \(status IN \('active', 'blocked'\)\)/i);
});
