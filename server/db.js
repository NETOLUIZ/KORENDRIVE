import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// node-postgres devolve NUMERIC e BIGINT como string por padrão (pra não perder
// precisão em números muito grandes). Nada aqui precisa disso — são valores
// monetários e contagens pequenas — e o frontend inteiro assume número de
// verdade (ex: chama .toFixed() direto), então convertemos na raiz do driver
// em vez de espalhar Number(...) em cada rota.
pg.types.setTypeParser(1700, (val) => parseFloat(val)); // NUMERIC
pg.types.setTypeParser(20, (val) => parseInt(val, 10)); // BIGINT (ex: COUNT(*))

// A aplicação roda com uma role SEM privilégio de superusuário (koren_app) —
// isso é obrigatório pra RLS valer alguma coisa: um superusuário do Postgres
// ignora Row-Level Security sempre, mesmo com FORCE ROW LEVEL SECURITY (não
// existe exceção pra isso). A role padrão do Postgres em Docker (POSTGRES_USER)
// É superusuário, então ela só é usada aqui pra rodar a migração/schema —
// nunca pra servir requisição.
const pgHost = process.env.POSTGRES_HOST || '127.0.0.1';
const pgPort = process.env.POSTGRES_PORT || '5432';
const pgDb = process.env.POSTGRES_DB || 'koren_driver';
const appPassword = process.env.APP_DB_PASSWORD || 'dev_local_app_only_change_in_prod';
const pgUser = process.env.POSTGRES_USER || 'koren';
const pgPassword = process.env.POSTGRES_PASSWORD || 'dev_local_only_change_in_prod';

export const DATABASE_URL = process.env.DATABASE_URL || `postgres://koren_app:${encodeURIComponent(appPassword)}@${pgHost}:${pgPort}/${pgDb}`;
export const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL || `postgres://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDb}`;

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

function slugify(str) {
  const from = String.fromCharCode(0x0300);
  const to = String.fromCharCode(0x036f);
  const diacritics = new RegExp('[' + from + '-' + to + ']', 'g');
  return (str || '')
    .normalize('NFD').replace(diacritics, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Gera o slug do Link Direto de Corrida Particular (ex: koren.app/p/joaosilva)
export async function generateDriverSlug(client, name) {
  const base = slugify(name) || 'motorista';
  let slug = base;
  let i = 1;
  while (true) {
    const { rows } = await client.query('SELECT id FROM drivers WHERE public_slug = $1', [slug]);
    if (rows.length === 0) return slug;
    slug = `${base}${i}`;
    i++;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

// Cria/atualiza a role de runtime sem privilégio de superusuário e concede só
// o necessário (CRUD nas tabelas + usar as sequences dos SERIAL). Roda com a
// role de migração (superusuário), a única com permissão de criar roles.
async function ensureAppRole(migrationClient) {
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!appPassword) {
    throw new Error('APP_DB_PASSWORD não definido — necessário para criar a role de runtime sem privilégio de superusuário.');
  }
  const escapedPassword = appPassword.replace(/'/g, "''");

  await migrationClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'koren_app') THEN
        CREATE ROLE koren_app LOGIN PASSWORD '${escapedPassword}';
      ELSE
        ALTER ROLE koren_app LOGIN PASSWORD '${escapedPassword}';
      END IF;
    END $$;
  `);
  await migrationClient.query('GRANT USAGE ON SCHEMA public TO koren_app');
  await migrationClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO koren_app');
  await migrationClient.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koren_app');
}

// Inicialização do banco: aplica o schema (idempotente), garante a role de
// runtime restrita, e garante que sempre exista o Super Admin real (via
// SUPER_ADMIN_EMAIL/PASSWORD). Sem seed de dados de demonstração — um banco
// novo começa vazio, só com essa conta. Usa a role de migração (superusuário)
// só aqui — nunca para servir requisições.
export async function initDB() {
  // Todo o trabalho de inicialização (schema, criação de role, seeds, limpeza)
  // é feito com a role de migração (superusuário) — é trabalho de bootstrap
  // de confiança total, não uma requisição de usuário, então não faz sentido
  // (e não funcionaria: RLS bloquearia os inserts de seed sem sessão) rodar
  // isso pela role restrita.
  const migrationPool = new pg.Pool({ connectionString: MIGRATION_DATABASE_URL });
  const client = await migrationPool.connect();
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    await ensureAppRole(client);

    // Limpeza oportunista de sessões vencidas
    await client.query('DELETE FROM sessions WHERE expires_at < now()');

    const { rows: superAdminCount } = await client.query("SELECT COUNT(*) as count FROM admins WHERE role = 'super_admin'");
    if (Number(superAdminCount[0].count) === 0) {
      await seedSuperAdmin(client);
    } else if (process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
      // Já existe super admin (de um boot anterior) — sincroniza a credencial
      // com o .env em vez de criar um segundo, já que só devia haver um.
      const { hash, salt } = hashPassword(process.env.SUPER_ADMIN_PASSWORD);
      await client.query(
        "UPDATE admins SET email = $1, password_hash = $2, password_salt = $3 WHERE role = 'super_admin'",
        [process.env.SUPER_ADMIN_EMAIL, hash, salt]
      );
    }
  } finally {
    client.release();
    await migrationPool.end();
  }
}

async function seedSuperAdmin(client) {
  const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@koren.app';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'koren@2026';
  const { hash, salt } = hashPassword(password);
  await client.query(`
    INSERT INTO admins (name, email, password_hash, password_salt, company_name, role, invite_token, status, payment_status)
    VALUES ($1, $2, $3, $4, $5, 'super_admin', NULL, 'active', 'em_dia')
  `, ['Super Admin koren', email, hash, salt, null]);
}
