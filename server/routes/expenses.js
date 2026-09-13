import express from 'express';
import { requireDriver } from '../middleware/auth.js';
import { withDbContext } from '../middleware/dbContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Obter resumo de custos e histórico de despesas do motorista autenticado
router.get('/', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const { rows: expenses } = await req.db.query(
    'SELECT * FROM expenses WHERE driver_id = $1 ORDER BY id DESC',
    [req.driver.id]
  );

  const totalCosts = expenses.reduce((acc, curr) => acc + Number(curr.amount), 0);
  const grossRevenue = 3260.00;
  const netProfit = grossRevenue - totalCosts;

  const fuelCosts = expenses
    .filter(e => e.category.toLowerCase().includes('combustivel'))
    .reduce((acc, curr) => acc + Number(curr.amount), 0);

  const fuelPercentage = totalCosts > 0 ? ((fuelCosts / totalCosts) * 100).toFixed(1) : 0;

  res.json({
    metrics: { totalCosts, grossRevenue, netProfit, fuelCosts, fuelPercentage, partnerSavings: 54.10 },
    expenses
  });
}));

// Cadastrar nova despesa
router.post('/', requireDriver, withDbContext, asyncHandler(async (req, res) => {
  const { category, title, amount, date_time, notes } = req.body;

  if (!category || !amount) {
    return res.status(400).json({ error: 'Categoria e Valor são obrigatórios' });
  }

  const defaultTitles = {
    combustivel: 'Combustível',
    pedagio: 'Pedágio',
    lavagem: 'Lavagem Automotiva',
    manutencao: 'Manutenção / Peças',
    alimentacao: 'Alimentação'
  };

  const finalTitle = title || defaultTitles[category] || 'Despesa Avulsa';
  const now = new Date();
  const formattedDate = date_time || `Hoje, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const { rows } = await req.db.query(`
    INSERT INTO expenses (driver_id, category, title, amount, date_time, notes)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [req.driver.id, category, finalTitle, parseFloat(amount), formattedDate, notes || '']);

  res.json({ success: true, expense: rows[0] });
}));

export default router;
