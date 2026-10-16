import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);

test('rides persist a unique public tracking token and latest driver location', async () => {
  const schema = await readFile(new URL('server/schema.sql', root), 'utf8');
  assert.match(schema, /tracking_token\s+TEXT\s+UNIQUE/i);
  assert.match(schema, /driver_lat\s+NUMERIC\(10,7\)/i);
  assert.match(schema, /driver_lng\s+NUMERIC\(10,7\)/i);
  assert.match(schema, /driver_location_at\s+TIMESTAMPTZ/i);
});
