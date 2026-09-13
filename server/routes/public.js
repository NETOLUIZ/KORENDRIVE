import express from 'express';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Dados públicos do motorista pra tela de solicitação (Link Direto).
// Sem autenticação por design — mas nunca faz SELECT *, escolhe as colunas a
// dedo (o RLS trava por linha, não por coluna, então isso continua obrigatório).
router.get('/driver/:slug', withDbContext, asyncHandler(async (req, res) => {
  // Só essa rota, sem autenticação nenhuma, tem permissão de enxergar a linha
  // pública de um motorista — ver a política drivers_public_link em schema.sql.
  await req.db.query("SELECT set_config('app.bypass_public_rls', 'true', true)");

  const { rows } = await req.db.query(
    'SELECT id, name, phone, rating, category FROM drivers WHERE public_slug = $1',
    [req.params.slug]
  );
  const driver = rows[0];

  if (!driver) {
    return res.status(404).json({ error: 'Motorista não encontrado' });
  }

  const { rows: vehicleRows } = await req.db.query(
    'SELECT model, plate, color FROM vehicles WHERE driver_id = $1 ORDER BY is_active DESC LIMIT 1',
    [driver.id]
  );
  const { rows: rateRows } = await req.db.query(
    'SELECT base_fare, km_rate, minute_rate, min_fare FROM driver_rates WHERE driver_id = $1',
    [driver.id]
  );

  res.json({
    driver: { name: driver.name, phone: driver.phone, rating: driver.rating, category: driver.category },
    vehicle: vehicleRows[0] || null,
    rates: rateRows[0] || { base_fare: 6.50, km_rate: 2.75, minute_rate: 0.45, min_fare: 15.00 }
  });
}));

export default router;
