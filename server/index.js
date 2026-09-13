import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB } from './db.js';
import authRoutes from './routes/auth.js';
import driverRoutes from './routes/driver.js';
import vehiclesRoutes from './routes/vehicles.js';
import expensesRoutes from './routes/expenses.js';
import ridesRoutes from './routes/rides.js';
import adminRoutes from './routes/admin.js';
import superadminRoutes from './routes/superadmin.js';
import publicRoutes from './routes/public.js';
import { friendlyError } from './utils/friendlyError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Middlewares
app.use(helmet({ contentSecurityPolicy: false })); // CSP desligado: o app serve HTML com scripts inline/CDN próprios
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : {}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limit nas rotas de login — únicos pontos de força bruta de senha do app
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});
app.use('/api/auth/login', loginLimiter);
app.use('/api/admin/login', loginLimiter);
app.use('/api/superadmin/login', loginLimiter);

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/rides', ridesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/public', publicRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'korenDriver API', timestamp: new Date().toISOString() });
});

// Painéis de Admin e Super Admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
app.get('/superadmin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'superadmin.html'));
});

// Link de convite do admin: redireciona pro cadastro do motorista com o token
app.get('/r/:token', (req, res) => {
  res.redirect('/?ref=' + encodeURIComponent(req.params.token));
});

// Link Direto de Corrida Particular: tela pública pro cliente solicitar corrida/frete/entrega
app.get('/p/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'booking.html'));
});

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Handler de erro central — nunca deixa stack trace, mensagem de SQL ou
// detalhe interno chegar no navegador. O erro completo só vai pro log do servidor.
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  if (res.headersSent) return next(err);

  // Alguns erros do Postgres (ex: e-mail/CPF duplicado) merecem uma mensagem
  // clara pro usuário mesmo em produção — não são falha interna, são um dado
  // que ele já tinha usado antes.
  const friendly = friendlyError(err);

  res.status(err.status || (friendly ? 400 : 500)).json({
    error: friendly || (isProduction ? 'Erro interno. Tente novamente.' : err.message)
  });
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[korenDriver] Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar o banco de dados:', err);
    process.exit(1);
  });
