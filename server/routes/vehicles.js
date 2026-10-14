import express from 'express';
import { requireDriver, requireApprovedDriver } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Listar veículos do motorista autenticado
router.get('/', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows: vehicles } = await req.db.query(
    'SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY is_active DESC, id DESC',
    [req.driver.id]
  );
  res.json({ vehicles });
}));

// Cadastrar novo veículo (Passo 2 do fluxo de cadastro)
router.post('/', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const { plate, model, year, color, fuel_type, photo_url, crlv_url } = req.body;

  if (!plate || !model) {
    return res.status(400).json({ error: 'Placa e Modelo são obrigatórios' });
  }

  const { rows: countRows } = await req.db.query(
    'SELECT COUNT(*) as count FROM vehicles WHERE driver_id = $1',
    [req.driver.id]
  );
  const isActive = Number(countRows[0].count) === 0;

  const { rows } = await req.db.query(`
    INSERT INTO vehicles (driver_id, plate, model, year, color, fuel_type, photo_url, crlv_url, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    req.driver.id,
    plate.toUpperCase(),
    model,
    year ? parseInt(year) : 2023,
    color || 'Prata',
    fuel_type || 'Flex',
    photo_url || '',
    crlv_url || '',
    isActive
  ]);

  res.json({ success: true, vehicle: rows[0] });
}));

// Ativar veículo selecionado (dono verificado via driver_id = req.driver.id na query, não confiando em nada do corpo)
router.patch('/:id/activate', requireDriver, requireApprovedDriver, withDbContext, asyncHandler(async (req, res) => {
  await req.db.query('UPDATE vehicles SET is_active = false WHERE driver_id = $1', [req.driver.id]);
  const { rows } = await req.db.query(
    'UPDATE vehicles SET is_active = true WHERE id = $1 AND driver_id = $2 RETURNING *',
    [req.params.id, req.driver.id]
  );

  if (!rows[0]) {
    return res.status(404).json({ error: 'Veículo não encontrado' });
  }
  res.json({ success: true, vehicle: rows[0] });
}));

export default router;
