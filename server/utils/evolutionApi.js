// Integração com a Evolution API (WhatsApp self-hospedado, infraestrutura
// compartilhada da Korentech). Se as variáveis não estiverem configuradas
// (ex: ambiente de dev local sem acesso à VPS), a função só avisa no log e
// segue — nunca deve derrubar um cadastro por causa de WhatsApp fora do ar.
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'Korendriver';

function normalizePhone(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length <= 11) digits = '55' + digits; // assume Brasil se vier sem DDI
  return digits;
}

// Manda uma mensagem de texto pelo WhatsApp — isso também é o que faz o
// contato "existir" de fato na Evolution API (não existe um endpoint
// separado de "cadastrar contato" independente de uma conversa).
export async function sendWhatsAppMessage(phone, text) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    console.warn('[evolutionApi] Não configurada (EVOLUTION_API_URL/KEY ausentes) — mensagem não enviada.');
    return { skipped: true };
  }

  const number = normalizePhone(phone);

  try {
    const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number, text })
    });

    if (!res.ok) {
      console.error('[evolutionApi] Erro ao enviar mensagem:', res.status, await res.text());
      return { success: false };
    }
    return { success: true };
  } catch (err) {
    console.error('[evolutionApi] Falha de conexão:', err.message);
    return { success: false };
  }
}
