import crypto from 'node:crypto';
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

// ---------------------------------------------------------------------------
// Recuperação de senha por WhatsApp
// ---------------------------------------------------------------------------
const RESET_COOLDOWN_SECONDS = 60;
const RESET_MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 6;

const hashResetCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

// Mesma resposta exista a conta ou não — senão essa rota viraria um jeito de
// descobrir quais e-mails/CPFs/telefones estão cadastrados.
const GENERIC_FORGOT_RESPONSE = {
  success: true,
  message: 'Se encontrarmos uma conta, enviamos um código de 6 dígitos para o WhatsApp cadastrado.'
};

// Passo 1: pede o código. Aceita e-mail, CPF ou telefone, igual ao login.
router.post('/forgot-password', withDbContext, asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  if (!identifier) return res.status(400).json({ error: 'Informe seu e-mail, CPF ou telefone.' });

  await req.db.query("SELECT set_config('app.bypass_login_rls', 'true', true)");
  const { rows } = await req.db.query(
    'SELECT id, name, phone FROM drivers WHERE email = $1 OR cpf = $1 OR phone = $1',
    [identifier]
  );
  const driver = rows[0];
  if (!driver) return res.json(GENERIC_FORGOT_RESPONSE);

  // Cooldown: evita usar a rota pra floodar o WhatsApp de alguém com códigos.
  const { rows: recent } = await req.db.query(
    `SELECT 1 FROM password_resets
     WHERE driver_id = $1 AND created_at > now() - make_interval(secs => $2)`,
    [driver.id, RESET_COOLDOWN_SECONDS]
  );
  if (recent.length) return res.json(GENERIC_FORGOT_RESPONSE);

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // Só o código mais recente vale — pedir um novo invalida os anteriores.
  await req.db.query('DELETE FROM password_resets WHERE driver_id = $1', [driver.id]);
  await req.db.query(
    'INSERT INTO password_resets (driver_id, code_hash) VALUES ($1, $2)',
    [driver.id, hashResetCode(code)]
  );

  res.json(GENERIC_FORGOT_RESPONSE);

  // Depois da resposta, igual ao WhatsApp de boas-vindas: nunca atrasa nem
  // revela (pelo tempo de resposta) se a conta existia.
  sendWhatsAppMessage(
    driver.phone,
    `🔐 *koren* — seu código para redefinir a senha é *${code}*. Vale por 15 minutos. Se não foi você, ignore esta mensagem.`
  ).catch((err) => console.error('Erro ao enviar WhatsApp de recuperação:', err));
}));

// Passo 2: confere o código e grava a nova senha.
router.post('/reset-password', withDbContext, asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const code = String(req.body.code || '').trim();
  const password = String(req.body.password || '');

  if (!identifier || !code || !password) {
    return res.status(400).json({ error: 'Preencha todos os campos.' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
  }

  const invalid = () => res.status(400).json({ error: 'Código inválido ou expirado. Peça um novo código.' });

  await req.db.query("SELECT set_config('app.bypass_login_rls', 'true', true)");
  const { rows } = await req.db.query(
    'SELECT id FROM drivers WHERE email = $1 OR cpf = $1 OR phone = $1',
    [identifier]
  );
  const driver = rows[0];
  if (!driver) return invalid();

  const { rows: resetRows } = await req.db.query(
    'SELECT * FROM password_resets WHERE driver_id = $1 AND expires_at > now() ORDER BY id DESC LIMIT 1',
    [driver.id]
  );
  const reset = resetRows[0];
  if (!reset || reset.attempts >= RESET_MAX_ATTEMPTS) return invalid();

  const given = Buffer.from(hashResetCode(code), 'hex');
  const stored = Buffer.from(reset.code_hash, 'hex');
  if (!crypto.timingSafeEqual(given, stored)) {
    // O contador precisa sobreviver à resposta de erro, mas withDbContext
    // reverte a transação em qualquer status >= 400. Por isso o erro sai como
    // 200 com success:false só nesse caso.
    await req.db.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [reset.id]);
    return res.json({ success: false, error: 'Código incorreto.' });
  }

  // A partir daqui a transação "vira" o dono do registro, pra política
  // drivers_self permitir o UPDATE (mesmo truque do cadastro).
  await req.db.query('SELECT set_config($1, $2, true)', ['app.current_driver_id', String(driver.id)]);

  const { hash, salt } = hashPassword(password);
  await req.db.query('UPDATE drivers SET password_hash = $1, password_salt = $2 WHERE id = $3', [hash, salt, driver.id]);
  await req.db.query('DELETE FROM password_resets WHERE driver_id = $1', [driver.id]);
  // Derruba todas as sessões abertas: quem pediu a troca provavelmente perdeu
  // o controle da conta, então o login antigo não pode continuar valendo.
  await req.db.query('DELETE FROM sessions WHERE driver_id = $1', [driver.id]);

  res.json({ success: true, message: 'Senha redefinida! Faça login com a nova senha.' });
}));

// Logout
router.post('/logout', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await req.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
}));

export default router;
