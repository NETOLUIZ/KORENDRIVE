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

function publicCompany(company) {
  const { password_hash, password_salt, ...rest } = company;
  return rest;
}

export function validateCompanyPayload(payload = {}) {
  const company = payload.company || {};
  const admin = payload.admin || {};
  const required = [company.name, company.phone, company.email, company.address, company.plan, company.monthly_fee, admin.name, admin.email, admin.password];
  if (required.some(value => value === undefined || value === null || String(value).trim() === '')) return { ok: false, error: 'Preencha todos os campos obrigatórios.' };
  const cnpj = String(company.cnpj || '').replace(/\D/g, '');
  if (cnpj && cnpj.length !== 14) return { ok: false, error: 'CNPJ deve ter 14 dígitos.' };
  const monthly_fee = Number(company.monthly_fee);
  if (!Number.isFinite(monthly_fee) || monthly_fee < 0) return { ok: false, error: 'Mensalidade inválida.' };
  return { ok: true, value: { company: { ...company, cnpj: cnpj || null, monthly_fee }, admin } };
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

// Super admin define uma nova senha pro motorista independente (ex: ele perdeu
// o acesso e o WhatsApp de recuperação não chega). Derruba as sessões abertas,
// pra o login antigo não continuar valendo depois da troca.
router.patch('/drivers/:id/password', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  const { hash, salt } = hashPassword(password);
  const { rowCount } = await req.db.query(
    'UPDATE drivers SET password_hash = $1, password_salt = $2 WHERE id = $3 AND admin_id IS NULL',
    [hash, salt, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Motorista não encontrado' });

  await req.db.query('DELETE FROM sessions WHERE driver_id = $1', [req.params.id]);
  res.json({ success: true });
}));

router.get('/companies', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`SELECT c.*, a.name AS admin_name, a.email AS admin_email,
    (SELECT COUNT(*) FROM drivers d WHERE d.admin_id = c.admin_id) AS driver_count
    FROM companies c JOIN admins a ON a.id = c.admin_id ORDER BY c.created_at DESC`);
  res.json({ companies: rows.map(company => ({ ...publicCompany(company), driver_count: Number(company.driver_count) })) });
}));

router.post('/companies', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const validation = validateCompanyPayload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const { company, admin } = validation.value;
  const existing = await req.db.query('SELECT id FROM admins WHERE email = $1', [admin.email]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Já existe um administrador com este e-mail.' });
  const { hash, salt } = hashPassword(admin.password);
  const inviteToken = await generateInviteToken(req.db);
  const { rows: admins } = await req.db.query(`INSERT INTO admins (name, email, password_hash, password_salt, company_name, role, invite_token, status, payment_status, monthly_fee)
    VALUES ($1,$2,$3,$4,$5,'admin',$6,'active','em_dia',$7) RETURNING *`, [admin.name, admin.email, hash, salt, company.name, inviteToken, company.monthly_fee]);
  const responsible = admins[0];
  const { rows } = await req.db.query(`INSERT INTO companies (name, cnpj, phone, email, address, plan, monthly_fee, admin_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [company.name, company.cnpj, company.phone, company.email, company.address, company.plan, company.monthly_fee, responsible.id]);
  res.json({ success: true, company: publicCompany({ ...rows[0], admin_name: responsible.name, admin_email: responsible.email, driver_count: 0 }) });
}));

router.get('/companies/:id', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query('SELECT c.*, a.name AS admin_name, a.email AS admin_email FROM companies c JOIN admins a ON a.id = c.admin_id WHERE c.id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Empresa não encontrada.' });
  const company = rows[0];
  const drivers = await req.db.query('SELECT id, name, phone, email, status, approval_status, created_at FROM drivers WHERE admin_id = $1 ORDER BY created_at DESC', [company.admin_id]);
  res.json({ company: publicCompany(company), drivers: drivers.rows });
}));

router.patch('/companies/:id', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { name, cnpj, phone, email, address, plan, monthly_fee } = req.body;
  if (![name, phone, email, address, plan, monthly_fee].every(value => value !== undefined && String(value).trim() !== '')) return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  const { rows } = await req.db.query(`UPDATE companies SET name=$1, cnpj=$2, phone=$3, email=$4, address=$5, plan=$6, monthly_fee=$7, updated_at=now() WHERE id=$8 RETURNING *`, [name, String(cnpj || '').replace(/\D/g, '') || null, phone, email, address, plan, Number(monthly_fee), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Empresa não encontrada.' });
  await req.db.query('UPDATE admins SET company_name=$1, monthly_fee=$2 WHERE id=$3', [rows[0].name, rows[0].monthly_fee, rows[0].admin_id]);
  res.json({ success: true, company: publicCompany(rows[0]) });
}));

router.patch('/companies/:id/status', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'blocked'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  const { rows } = await req.db.query('UPDATE companies SET status=$1, updated_at=now() WHERE id=$2 RETURNING *', [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Empresa não encontrada.' });
  await req.db.query('UPDATE admins SET status=$1 WHERE id=$2', [status, rows[0].admin_id]);
  res.json({ success: true, company: publicCompany(rows[0]) });
}));

// Logout
router.post('/logout', requireSuperAdmin, withDbContext, asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await req.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
}));

export default router;
