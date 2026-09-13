import express from 'express';
import { requireDriver, publicDriver } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Dados do perfil e cockpit
router.get('/profile', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const driverId = req.driver.id;

  const { rows: vehicles } = await req.db.query(
    'SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY is_active DESC',
    [driverId]
  );
  const { rows: rateRows } = await req.db.query(
    'SELECT * FROM driver_rates WHERE driver_id = $1',
    [driverId]
  );

  res.json({
    driver: publicDriver(req.driver),
    vehicles,
    rates: rateRows[0] || null
  });
}));

// Alternar status Online / Offline
router.post('/toggle-status', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const newStatus = req.driver.status === 'online' ? 'offline' : 'online';
  await req.db.query('UPDATE drivers SET status = $1 WHERE id = $2', [newStatus, req.driver.id]);
  res.json({ success: true, status: newStatus });
}));

// Direito de acesso (LGPD Art. 18, II e V) — devolve tudo que o sistema tem
// sobre o motorista, pra ele baixar. Nunca inclui hash/salt de senha.
router.get('/export-data', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const driverId = req.driver.id;

  const { rows: vehicles } = await req.db.query('SELECT * FROM vehicles WHERE driver_id = $1', [driverId]);
  const { rows: expenses } = await req.db.query('SELECT * FROM expenses WHERE driver_id = $1', [driverId]);
  const { rows: rides } = await req.db.query('SELECT * FROM rides WHERE driver_id = $1', [driverId]);
  const { rows: rateRows } = await req.db.query('SELECT * FROM driver_rates WHERE driver_id = $1', [driverId]);

  res.setHeader('Content-Disposition', 'attachment; filename="meus-dados-koren.json"');
  res.json({
    exportado_em: new Date().toISOString(),
    perfil: publicDriver(req.driver),
    veiculos: vehicles,
    despesas: expenses,
    corridas: rides,
    tarifas: rateRows[0] || null
  });
}));

// Direito de exclusão / esquecimento (LGPD Art. 18, VI) — apaga a conta e tudo
// que depende dela (veículos, despesas, corridas, tarifas, sessões já têm
// ON DELETE CASCADE no schema, então uma linha já resolve tudo).
router.delete('/account', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  await req.db.query('DELETE FROM drivers WHERE id = $1', [req.driver.id]);
  res.json({ success: true });
}));

export default router;
