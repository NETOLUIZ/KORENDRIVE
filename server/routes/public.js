import express from 'express';
import crypto from 'node:crypto';
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

// Passageiro solicita a corrida pelo Link Direto — cria o pedido no sistema
// (aparece pro motorista aceitar no Cockpit) além da mensagem de WhatsApp
// que a própria tela já monta no navegador do passageiro.
router.post('/driver/:slug/request-ride', withDbContext, asyncHandler(async (req, res) => {
  // Mesmo escape usado no GET acima — só dá pra inserir a corrida se o
  // motorista do slug estiver aprovado e com o link compartilhável ligado
  // (ver política rides_public_insert em schema.sql, que reexige isso).
  await req.db.query("SELECT set_config('app.bypass_public_rls', 'true', true)");

  const { rows: driverRows } = await req.db.query(
    'SELECT id FROM drivers WHERE public_slug = $1', [req.params.slug]
  );
  const driver = driverRows[0];
  if (!driver) {
    return res.status(404).json({ error: 'Motorista não encontrado' });
  }

  const {
    passenger_name, passenger_phone, origin, destination,
    origin_lat, origin_lng, destination_lat, destination_lng,
    distance_km, duration_min, fare, notes
  } = req.body;

  if (!passenger_name || !origin || !destination || !fare) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  const now = new Date();
  const trackingToken = crypto.randomBytes(24).toString('base64url');
  const formattedDate = `Hoje, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Sem RETURNING de propósito: não existe (nem deve existir) política de
  // SELECT em rides pro passageiro anônimo — ele só tem acesso de escrita
  // (INSERT), nunca de leitura. RETURNING exigiria conseguir reler a própria
  // linha inserida, o que violaria RLS mesmo com o INSERT em si sendo válido.
  await req.db.query(`
    INSERT INTO rides (
      driver_id, passenger_name, passenger_phone, origin, destination,
      origin_lat, origin_lng, destination_lat, destination_lng,
      distance_km, duration_min, fare, status, date_time, notes, tracking_token
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'requested',$13,$14,$15)
  `, [
    driver.id, passenger_name, passenger_phone || '', origin, destination,
    origin_lat || null, origin_lng || null, destination_lat || null, destination_lng || null,
    parseFloat(distance_km) || 0, parseInt(duration_min) || 0, parseFloat(fare),
    formattedDate, notes || '', trackingToken
  ]);

  res.json({ success: true, tracking_token: trackingToken, tracking_url: `/tracking/${trackingToken}` });
}));

router.get('/tracking/:token', withDbContext, asyncHandler(async (req, res) => {
  await req.db.query("SELECT set_config('app.bypass_public_rls', 'true', true)");
  const { rows } = await req.db.query('SELECT status, driver_lat, driver_lng, driver_location_at FROM rides WHERE tracking_token = $1', [req.params.token]);
  const ride = rows[0];
  if (!ride || !['accepted', 'in_progress'].includes(ride.status)) return res.status(404).json({ error: 'Acompanhamento indisponível.' });
  res.json({ status: ride.status, driver_location: ride.driver_lat == null ? null : { lat: Number(ride.driver_lat), lng: Number(ride.driver_lng), updated_at: ride.driver_location_at } });
}));

export default router;
