import { sendWhatsAppMessage } from './evolutionApi.js';
import { publicDriver } from '../middleware/auth.js';

// Lógica compartilhada entre o admin (aprova/rejeita motorista da própria
// empresa) e o super admin (aprova/rejeita motorista independente) — a única
// diferença entre os dois é a cláusula extra do WHERE que escopa de quem é
// o motorista (admin_id = X vs admin_id IS NULL), passada por quem chama.
// Os placeholders dentro de extraWhereSql devem começar em $4 (depois de
// approval_status, rejection_reason e id, nessa ordem).
export async function handleDriverApproval(req, res, { extraWhereSql, extraWhereParams = [] }) {
  const { action, reason } = req.body;

  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'Ação inválida. Use "approve" ou "reject".' });
  }
  if (action === 'reject' && !reason) {
    return res.status(400).json({ error: 'Informe o motivo da rejeição.' });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const { rows } = await req.db.query(`
    UPDATE drivers
    SET approval_status = $1,
        rejection_reason = $2,
        approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END
    WHERE id = $3 AND approval_status = 'pending' AND ${extraWhereSql}
    RETURNING *
  `, [newStatus, action === 'reject' ? reason : null, req.params.id, ...extraWhereParams]);

  const driver = rows[0];
  if (!driver) {
    return res.status(404).json({ error: 'Motorista não encontrado ou já avaliado.' });
  }

  res.json({ success: true, driver: publicDriver(driver) });

  // Fora da transação visível pro cliente — nunca pode atrasar nem derrubar
  // a decisão de aprovação em si (mesmo padrão do welcome em auth.js).
  const message = action === 'approve'
    ? `Olá ${driver.name}! Seu cadastro na koren foi aprovado. Você já pode acessar o app normalmente. 🚗`
    : `Olá ${driver.name}, seu cadastro na koren não foi aprovado. Motivo: ${reason}`;
  sendWhatsAppMessage(driver.phone, message).catch(err => console.error('Erro ao enviar WhatsApp de aprovação:', err));
}
