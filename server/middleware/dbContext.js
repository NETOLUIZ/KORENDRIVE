import { pool } from '../db.js';

// Abre uma transação por requisição e injeta a identidade autenticada (req.driver/req.admin)
// como variáveis de sessão do Postgres, pra que as políticas de RLS enxerguem "quem está pedindo".
// Toda query dentro de uma rota que usa esse middleware precisa usar req.db, nunca o pool
// direto — senão pega outra conexão sem a identidade setada, e o RLS nega tudo.
export function withDbContext(req, res, next) {
  pool.connect()
    .then(async (client) => {
      req.db = client;
      let finished = false;

      // Commita/reverte ANTES da resposta ser enviada — nunca depois. Fazer isso
      // em res.on('finish') (que só dispara depois do response já ter saído) abre
      // uma corrida real: o cliente pode receber o token de uma sessão recém-criada
      // e já usar ele na próxima requisição antes do COMMIT ter de fato acontecido,
      // e essa próxima requisição não encontraria a sessão ainda.
      const finalize = async (commit) => {
        if (finished) return;
        finished = true;
        try {
          await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        } catch (err) {
          console.error('Erro ao finalizar transação:', err);
        } finally {
          client.release();
        }
      };

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        finalize(res.statusCode < 400).finally(() => originalJson(body));
        return res;
      };

      // Rede de segurança: se por algum motivo a rota nunca chamar res.json
      // (erro inesperado, conexão caiu), ainda assim libera a conexão.
      res.on('finish', () => finalize(res.statusCode < 400));
      res.on('close', () => finalize(false));

      try {
        await client.query('BEGIN');

        if (req.driver) {
          await client.query('SELECT set_config($1, $2, true)', ['app.current_driver_id', String(req.driver.id)]);
        }
        if (req.admin) {
          await client.query('SELECT set_config($1, $2, true)', ['app.current_admin_id', String(req.admin.id)]);
          if (req.admin.role === 'super_admin') {
            await client.query("SELECT set_config('app.current_role', 'super_admin', true)");
          }
        }

        next();
      } catch (err) {
        await finalize(false);
        next(err);
      }
    })
    .catch(next);
}
