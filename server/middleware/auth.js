import crypto from 'node:crypto';
import { pool } from '../db.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, salt, hash) {
  const computed = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

// Aceita um client opcional (req.db) pra rodar na MESMA transação de quem chamou —
// essencial quando a sessão é criada logo após inserir o próprio admin/motorista
// na mesma requisição: usar o pool direto pegaria outra conexão que ainda não
// enxerga a linha recém-criada (não commitada), e a FK de sessions rejeitaria.
export async function createSession({ adminId, driverId }, client = pool) {
  const token = crypto.randomBytes(24).toString('hex');
  await client.query(
    'INSERT INTO sessions (token, admin_id, driver_id) VALUES ($1, $2, $3)',
    [token, adminId || null, driverId || null]
  );
  return token;
}

export function publicDriver(driver) {
  const { password_hash, password_salt, ...rest } = driver;
  return rest;
}

function getToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

async function getSessionAdmin(req) {
  const token = getToken(req);
  if (!token) return null;

  const { rows } = await pool.query(`
    SELECT admins.* FROM sessions
    JOIN admins ON admins.id = sessions.admin_id
    WHERE sessions.token = $1 AND sessions.expires_at > now()
  `, [token]);
  return rows[0] || null;
}

// Verificar uma sessão de motorista precisa ler a tabela drivers ANTES de
// req.driver existir (é literalmente o que essa função estabelece) — mesma
// situação do login. Precisa de BEGIN/COMMIT explícitos aqui: set_config com
// is_local=true só é revertido no fim de uma transação de verdade; chamado
// fora de uma (como um pool.query() solto faria) ele vaza pro resto da vida
// da conexão, e ela volta pro pool assim — um vazamento real de bypass de RLS.
async function getSessionDriver(req) {
  const token = getToken(req);
  if (!token) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.bypass_login_rls', 'true', true)");
    const { rows } = await client.query(`
      SELECT drivers.* FROM sessions
      JOIN drivers ON drivers.id = sessions.driver_id
      WHERE sessions.token = $1 AND sessions.expires_at > now()
    `, [token]);
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function requireAdmin(req, res, next) {
  try {
    const admin = await getSessionAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
    }
    if (admin.status === 'blocked') {
      return res.status(403).json({ error: 'Conta bloqueada. Contate o suporte.' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireSuperAdmin(req, res, next) {
  try {
    const admin = await getSessionAdmin(req);
    if (!admin || admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Acesso restrito ao Super Admin.' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireDriver(req, res, next) {
  try {
    const driver = await getSessionDriver(req);
    if (!driver) {
      return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
    }
    req.driver = driver;
    next();
  } catch (err) {
    next(err);
  }
}

// Bloqueia as funcionalidades do app pra motorista ainda não aprovado (ou
// rejeitado) — ele consegue logar e ver a própria tela de status, mas nada
// além disso. Vem sempre depois de requireDriver, que já populou req.driver.
export function requireApprovedDriver(req, res, next) {
  if (req.driver.approval_status !== 'approved') {
    return res.status(403).json({
      error: 'Cadastro ainda em análise.',
      approval_status: req.driver.approval_status,
      rejection_reason: req.driver.rejection_reason || null
    });
  }
  next();
}
