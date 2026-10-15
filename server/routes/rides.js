import express from 'express';
import { requireDriver, requireApprovedDriver } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { applyCompletedRideStats } from '../utils/driverStats.js';

const router = express.Router();

// Listar tarifas e histórico de corridas do motorista autenticado
router.get('/', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows: rateRows } = await req.db.query('SELECT * FROM driver_rates WHERE driver_id = $1', [req.driver.id]);
  const rates = rateRows[0] || { base_fare: 6.50, km_rate: 2.75, minute_rate: 0.45, min_fare: 15.00, pix_key: '' };

  const { rows: rides } = await req.db.query(
    'SELECT * FROM rides WHERE driver_id = $1 ORDER BY id DESC',
    [req.driver.id]
  );

  res.json({ rates, rides });
}));

// Atualizar tarifas particulares
router.put('/rates', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { base_fare, km_rate, minute_rate, min_fare, pix_key } = req.body;

  if (req.driver.can_edit_rates === false) {
    return res.status(403).json({ error: 'Edição de tarifas bloqueada pelo administrador. Peça liberação ao seu admin.' });
  }

  const { rows: existing } = await req.db.query('SELECT id FROM driver_rates WHERE driver_id = $1', [req.driver.id]);

  let rates;
  if (existing[0]) {
    const { rows } = await req.db.query(`
      UPDATE driver_rates SET base_fare = $1, km_rate = $2, minute_rate = $3, min_fare = $4, pix_key = $5
      WHERE driver_id = $6
      RETURNING *
    `, [parseFloat(base_fare), parseFloat(km_rate), parseFloat(minute_rate), parseFloat(min_fare), pix_key || '', req.driver.id]);
    rates = rows[0];
  } else {
    const { rows } = await req.db.query(`
      INSERT INTO driver_rates (driver_id, base_fare, km_rate, minute_rate, min_fare, pix_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.driver.id, parseFloat(base_fare), parseFloat(km_rate), parseFloat(minute_rate), parseFloat(min_fare), pix_key || '']);
    rates = rows[0];
  }

  res.json({ success: true, rates });
}));

// Resumo de corridas dos últimos 7 dias (alimenta o Cockpit) — só conta
// corrida concluída de verdade; 'requested'/'accepted'/'in_progress' ainda
// não aconteceram, não podem inflar o faturamento da semana.
router.get('/week-summary', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    SELECT COUNT(*) as count, COALESCE(SUM(fare), 0) as total
    FROM rides
    WHERE driver_id = $1 AND status = 'completed' AND created_at >= now() - INTERVAL '7 days'
  `, [req.driver.id]);

  res.json({ count: Number(rows[0].count), total: Number(rows[0].total) });
}));

// Pedidos de corrida pendentes (vindos do Link Direto) — payload leve pro
// polling do Cockpit, sem buscar tarifas junto.
router.get('/pending', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    SELECT * FROM rides
    WHERE driver_id = $1 AND status IN ('requested', 'accepted', 'in_progress')
    ORDER BY created_at ASC
  `, [req.driver.id]);

  res.json({ rides: rows });
}));

// Transições do ciclo de vida do pedido — cada uma só avança a partir do
// status esperado (a cláusula AND status=... na WHERE evita corrida dupla
// de clique ou uma transição fora de ordem passar batido).
router.patch('/:id/accept', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    UPDATE rides SET status = 'accepted', accepted_at = now()
    WHERE id = $1 AND driver_id = $2 AND status = 'requested'
    RETURNING *
  `, [req.params.id, req.driver.id]);

  if (!rows[0]) return res.status(404).json({ error: 'Pedido não encontrado ou já avaliado.' });
  res.json({ success: true, ride: rows[0] });
}));

router.patch('/:id/start', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    UPDATE rides SET status = 'in_progress', started_at = now()
    WHERE id = $1 AND driver_id = $2 AND status = 'accepted'
    RETURNING *
  `, [req.params.id, req.driver.id]);

  if (!rows[0]) return res.status(404).json({ error: 'Corrida não encontrada ou em outro status.' });
  res.json({ success: true, ride: rows[0] });
}));

router.patch('/:id/complete', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    UPDATE rides SET status = 'completed', completed_at = now()
    WHERE id = $1 AND driver_id = $2 AND status = 'in_progress'
    RETURNING *
  `, [req.params.id, req.driver.id]);

  if (!rows[0]) return res.status(404).json({ error: 'Corrida não encontrada ou em outro status.' });

  const ride = rows[0];
  await applyCompletedRideStats(req.db, req.driver.id, Number(ride.fare), Number(ride.distance_km));

  res.json({ success: true, ride });
}));

router.patch('/:id/cancel', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(`
    UPDATE rides SET status = 'cancelled'
    WHERE id = $1 AND driver_id = $2 AND status IN ('requested', 'accepted', 'in_progress')
    RETURNING *
  `, [req.params.id, req.driver.id]);

  if (!rows[0]) return res.status(404).json({ error: 'Corrida não encontrada ou já finalizada.' });
  res.json({ success: true, ride: rows[0] });
}));

// Registrar uma corrida realizada
router.post('/', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { passenger_name, passenger_phone, origin, destination, distance_km, duration_min, fare, notes } = req.body;

  if (!passenger_name || !origin || !destination || !fare) {
    return res.status(400).json({ error: 'Passageiro, origem, destino e valor são obrigatórios' });
  }

  const now = new Date();
  const formattedDate = `Hoje, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const parsedFare = parseFloat(fare);
  const parsedDistance = parseFloat(distance_km) || 0;

  const { rows } = await req.db.query(`
    INSERT INTO rides (driver_id, passenger_name, passenger_phone, origin, destination, distance_km, duration_min, fare, status, date_time, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10)
    RETURNING *
  `, [
    req.driver.id, passenger_name, passenger_phone || '', origin, destination,
    parsedDistance, parseInt(duration_min) || 0, parsedFare, formattedDate, notes || ''
  ]);

  await applyCompletedRideStats(req.db, req.driver.id, parsedFare, parsedDistance);

  res.json({ success: true, ride: rows[0] });
}));

// Simular estimativa de corrida particular
router.post('/simulate', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { distance_km, duration_min } = req.body;

  const { rows: rateRows } = await req.db.query('SELECT * FROM driver_rates WHERE driver_id = $1', [req.driver.id]);
  const rates = rateRows[0] || { base_fare: 6.50, km_rate: 2.75, minute_rate: 0.45, min_fare: 15.00 };

  const km = parseFloat(distance_km) || 0;
  const min = parseInt(duration_min) || 0;

  let calculated = Number(rates.base_fare) + (km * Number(rates.km_rate)) + (min * Number(rates.minute_rate));
  if (calculated < Number(rates.min_fare)) {
    calculated = Number(rates.min_fare);
  }

  res.json({
    distance_km: km,
    duration_min: min,
    estimated_fare: parseFloat(calculated.toFixed(2)),
    rates
  });
}));

export default router;
