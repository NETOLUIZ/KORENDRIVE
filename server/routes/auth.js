import express from 'express';
import { generateDriverSlug } from '../db.js';
import { hashPassword, verifyPassword, createSession, publicDriver, requireDriver } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendWhatsAppMessage } from '../utils/evolutionApi.js';

const router = express.Router();

// Sobe esse número toda vez que o texto de Termos/Política mudar de verdade —
// é o que fica gravado como prova do que a pessoa realmente aceitou.
const TERMS_VERSION = 'v1-2026-09';

// Login do motorista
router.post('/login', withDbContext, asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  // Login precisa achar o motorista antes de qualquer sessão existir — ver
  // a política drivers_login_lookup em schema.sql para o porquê disso ser seguro.
  await req.db.query("SELECT set_config('app.bypass_login_rls', 'true', true)");
  const { rows } = await req.db.query(
    'SELECT * FROM drivers WHERE email = $1 OR cpf = $1 OR phone = $1',
    [identifier]
  );
  const driver = rows[0];

  if (!driver || !verifyPassword(password || '', driver.password_salt, driver.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const token = await createSession({ driverId: driver.id }, req.db);
  res.json({ success: true, token, driver: publicDriver(driver) });
}));

// Cadastro Passo 1: Motorista
router.post('/register', withDbContext, asyncHandler(async (req, res) => {
  const { name, cpf, phone, email, password, address, cnh_front, cnh_back, admin_ref, terms_accepted } = req.body;

  if (!name || !cpf || !phone || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }
  if (terms_accepted !== true) {
    return res.status(400).json({ error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade para se cadastrar.' });
  }

  let adminId = null;
  if (admin_ref) {
    const { rows } = await req.db.query("SELECT id FROM admins WHERE invite_token = $1 AND role = 'admin'", [admin_ref]);
    if (rows[0]) adminId = rows[0].id;
  }

  // Antes de existir sessão, o cadastro precisa: (1) conseguir checar colisão de
  // slug em generateDriverSlug, e (2) ler de volta a própria linha que acabou de
  // inserir (RETURNING exige visibilidade, que é uma checagem equivalente a SELECT).
  // Reaproveita a mesma flag/política do login — o motivo de ser seguro é o mesmo:
  // só o código do servidor liga isso, nunca o cliente.
  await req.db.query("SELECT set_config('app.bypass_login_rls', 'true', true)");

  const publicSlug = await generateDriverSlug(req.db, name);
  const { hash, salt } = hashPassword(password);

  const { rows: driverRows } = await req.db.query(`
    INSERT INTO drivers (name, cpf, phone, email, password_hash, password_salt, address, cnh_front, cnh_back, status, admin_id, public_slug, terms_version, terms_accepted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'online', $10, $11, $12, now())
    RETURNING *
  `, [name, cpf, phone, email, hash, salt, address || '', cnh_front || '', cnh_back || '', adminId, publicSlug, TERMS_VERSION]);

  const driver = driverRows[0];

  // A partir daqui a transação "vira" o dono do registro recém-criado, pra que a
  // política de RLS driver_rates_self (USING driver_id = current_driver_id) permita o insert.
  await req.db.query('SELECT set_config($1, $2, true)', ['app.current_driver_id', String(driver.id)]);

  await req.db.query(`
    INSERT INTO driver_rates (driver_id, base_fare, km_rate, minute_rate, min_fare, pix_key)
    VALUES ($1, 6.50, 2.75, 0.45, 15.00, $2)
  `, [driver.id, email]);

  const token = await createSession({ driverId: driver.id }, req.db);
  res.json({ success: true, token, driver: publicDriver(driver) });

  // Fora da transação, depois da resposta já ter ido — mandar a mensagem de
  // boas-vindas nunca pode atrasar nem derrubar o cadastro em si.
  sendWhatsAppMessage(
    phone,
    `Olá ${name}! 🚗 Seu cadastro na *koren* foi concluído com sucesso. Seja bem-vindo(a) à plataforma!`
  ).catch((err) => console.error('Erro ao enviar WhatsApp de boas-vindas:', err));
}));

// Logout
router.post('/logout', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await req.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
}));

export default router;
