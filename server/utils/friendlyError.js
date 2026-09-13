// Traduz erros comuns do Postgres pra mensagens que fazem sentido pro usuário,
// em vez de deixar o texto cru do banco vazar (ou virar um genérico "erro interno"
// pra um caso que na verdade é só "esse e-mail já existe").
export function friendlyError(err) {
  if (err.code === '23505') {
    return 'Já existe um cadastro com esse e-mail, CPF ou telefone.';
  }
  return null;
}
