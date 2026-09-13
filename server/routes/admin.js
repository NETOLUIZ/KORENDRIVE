import express from 'express';
import { verifyPassword, createSession, requireAdmin } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function publicAdmin(admin) {
  const { password_hash, password_salt, ...rest } = admin;
  return rest;
}

// Login do Admin
router.post('/login', withDbContext, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await req.db.query("SELECT * FROM admins WHERE email = $1 AND role = 'admin'", [email]);
  const admin = rows[0];

  if (!admin) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  if (admin.status === 'blocked') {
    return res.status(403).json({ error: 'Conta bloqueada. Contate o suporte.' });
  }
  if (!verifyPassword(password || '', admin.password_salt, admin.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  const token = await createSession({ adminId: admin.id }, req.db);
  res.json({ success: true, token, admin: publicAdmin(admin) });
}));

// Dados do admin autenticado
router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: publicAdmin(req.admin) });
});

// Listar motoristas do admin
router.get('/drivers', requireAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows: drivers } = await req.db.query(`
    SELECT id, name, phone, email, status, category, rating, can_edit_rates, can_share_direct_link, created_at
    FROM drivers WHERE admin_id = $1 ORDER BY created_at DESC
  `, [req.admin.id]);

  res.json({ drivers });
}));

// Atualizar permissões de um motorista do admin
router.patch('/drivers/:id/permissions', requireAdmin, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query('SELECT * FROM drivers WHERE id = $1 AND admin_id = $2', [req.params.id, req.admin.id]);
  const driver = rows[0];
  if (!driver) {
    return res.status(404).json({ error: 'Motorista não encontrado' });
  }

  const canEditRates = req.body.can_edit_rates !== undefined ? Boolean(req.body.can_edit_rates) : driver.can_edit_rates;
  const canShareLink = req.body.can_share_direct_link !== undefined ? Boolean(req.body.can_share_direct_link) : driver.can_share_direct_link;

  const { rows: updatedRows } = await req.db.query(
    'UPDATE drivers SET can_edit_rates = $1, can_share_direct_link = $2 WHERE id = $3 RETURNING *',
    [canEditRates, canShareLink, driver.id]
  );

  res.json({ success: true, driver: updatedRows[0] });
}));

// Logout
router.post('/logout', requireAdmin, withDbContext, asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await req.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
}));

export default router;
