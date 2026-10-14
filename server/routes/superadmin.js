import express from 'express';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, createSession, requireSuperAdmin, publicDriver } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleDriverApproval } from '../utils/driverApproval.js';

const router = express.Router();

function publicAdmin(admin) {
  const { password_hash, password_salt, ...rest } = admin;
  return rest;
}

async function generateInviteToken(db) {
  for (let i = 0; i < 5; i++) {
    const token = crypto.randomBytes(6).toString('base64url');
    const { rows } = await db.query('SELECT id FROM admins WHERE invite_token = $1', [token]);
    if (rows.length === 0) return token;
  }
  throw new Error('Não foi possível gerar um token único');
}

// Login do Super Admin
router.post('/login', withDbContext, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await req.db.query("SELECT * FROM admins WHERE email = $1 AND role = 'super_admin'", [email]);
  const admin = rows[0];

  if (!admin || !verifyPassword(password || '', admin.password_salt, admin.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  const token = await createSession({ adminId: admin.id }, req.db);
  res.json({ success: true, token, admin: publicAdmin(admin) });
}));

// Listar todos os admins com contagem de motoristas
router.get('/admins', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows: admins } = await req.db.query(`
    SELECT a.id, a.name, a.email, a.company_name, a.status, a.payment_status, a.invite_token, a.monthly_fee, a.created_at,
           (SELECT COUNT(*) FROM drivers d WHERE d.admin_id = a.id) AS driver_count
    FROM admins a
    WHERE a.role = 'admin'
    ORDER BY a.created_at DESC
  `);

  res.json({ admins: admins.map(a => ({ ...a, driver_count: Number(a.driver_count), monthly_fee: Number(a.monthly_fee) })) });
}));

// Resumo financeiro: quanto está em dia (recebido) x em atraso, pra montar o dashboard
router.get('/billing-summary', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    SELECT name, company_name, payment_status, monthly_fee
    FROM admins WHERE role = 'admin'
    ORDER BY monthly_fee DESC
  `);
  const admins = rows.map(a => ({ ...a, monthly_fee: Number(a.monthly_fee) }));

  const totalReceived = admins.filter(a => a.payment_status === 'em_dia').reduce((sum, a) => sum + a.monthly_fee, 0);
  const totalOverdue = admins.filter(a => a.payment_status === 'inadimplente').reduce((sum, a) => sum + a.monthly_fee, 0);
  const countEmDia = admins.filter(a => a.payment_status === 'em_dia').length;
  const countInadimplente = admins.filter(a => a.payment_status === 'inadimplente').length;

  res.json({ totalReceived, totalOverdue, countEmDia, countInadimplente, admins });
}));

// Criar novo admin
router.post('/admins', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { name, email, password, company_name, monthly_fee } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
  }

  const { hash, salt } = hashPassword(password);
  const inviteToken = await generateInviteToken(req.db);
  const fee = parseFloat(monthly_fee) || 99.90;

  const { rows } = await req.db.query(`
    INSERT INTO admins (name, email, password_hash, password_salt, company_name, role, invite_token, status, payment_status, monthly_fee)
    VALUES ($1, $2, $3, $4, $5, 'admin', $6, 'active', 'em_dia', $7)
    RETURNING *
  `, [name, email, hash, salt, company_name || '', inviteToken, fee]);

  res.json({ success: true, admin: publicAdmin(rows[0]) });
}));

// Bloquear admin
router.patch('/admins/:id/block', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(
    "UPDATE admins SET status = 'blocked' WHERE id = $1 AND role = 'admin' RETURNING *",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Admin não encontrado' });
  res.json({ success: true, admin: publicAdmin(rows[0]) });
}));

// Desbloquear admin
router.patch('/admins/:id/unblock', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(
    "UPDATE admins SET status = 'active' WHERE id = $1 AND role = 'admin' RETURNING *",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Admin não encontrado' });
  res.json({ success: true, admin: publicAdmin(rows[0]) });
}));

// Atualizar status de pagamento
router.patch('/admins/:id/payment-status', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { payment_status } = req.body;
  if (!['em_dia', 'inadimplente'].includes(payment_status)) {
    return res.status(400).json({ error: 'payment_status inválido' });
  }

  const { rows } = await req.db.query(
    "UPDATE admins SET payment_status = $1 WHERE id = $2 AND role = 'admin' RETURNING *",
    [payment_status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Admin não encontrado' });
  res.json({ success: true, admin: publicAdmin(rows[0]) });
}));

// Listar motoristas independentes (sem empresa vinculada)
router.get('/drivers', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows: drivers } = await req.db.query(`
    SELECT id, name, phone, email, status, category, rating, approval_status, created_at
    FROM drivers WHERE admin_id IS NULL ORDER BY (approval_status = 'pending') DESC, created_at DESC
  `);

  res.json({ drivers });
}));

// Detalhe completo de um motorista independente (documentos pra revisão de cadastro)
router.get('/drivers/:id', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query('SELECT * FROM drivers WHERE id = $1 AND admin_id IS NULL', [req.params.id]);
  const driver = rows[0];
  if (!driver) {
    return res.status(404).json({ error: 'Motorista não encontrado' });
  }

  const { rows: vehicles } = await req.db.query('SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY is_active DESC', [req.params.id]);
  res.json({ driver: publicDriver(driver), vehicles });
}));

// Aprovar ou rejeitar o cadastro de um motorista independente
router.patch('/drivers/:id/approval', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  await handleDriverApproval(req, res, {
    extraWhereSql: 'admin_id IS NULL'
  });
}));

// Logout
router.post('/logout', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await req.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
}));

export default router;
