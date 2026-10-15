// Atualiza os números do Cockpit (Ganhos de Hoje) quando uma corrida é
// concluída de verdade. "Hoje" se auto-reseta sozinho: se a última
// atualização não foi hoje, começa do zero em vez de acumular (CASE
// compara today_stats_date com CURRENT_DATE) — sem precisar de um job
// de meia-noite rodando à parte.
export async function applyCompletedRideStats(db, driverId, fare, distanceKm) {
  await db.query(`
    UPDATE drivers SET
      today_earnings = CASE WHEN today_stats_date = CURRENT_DATE THEN today_earnings + $1 ELSE $1 END,
      today_rides = CASE WHEN today_stats_date = CURRENT_DATE THEN today_rides + 1 ELSE 1 END,
      km_driven = CASE WHEN today_stats_date = CURRENT_DATE THEN km_driven + $2 ELSE $2 END,
      today_stats_date = CURRENT_DATE
    WHERE id = $3
  `, [fare, distanceKm || 0, driverId]);
}
