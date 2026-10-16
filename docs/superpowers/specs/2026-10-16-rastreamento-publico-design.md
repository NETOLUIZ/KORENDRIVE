# Rastreamento Público da Corrida

## Objetivo

Permitir que o passageiro acompanhe, no mesmo link público usado para pedir a corrida, a localização atual do motorista a partir do aceite até a conclusão ou o cancelamento da corrida.

## Escopo

O motorista compartilha a própria localização apenas enquanto a corrida estiver nos estados `accepted` ou `in_progress`. O passageiro acessa uma tela pública de acompanhamento associada exclusivamente àquela corrida. Concluir ou cancelar encerra imediatamente o acesso às coordenadas.

Ficam fora deste incremento WebSockets, histórico de trajetos, compartilhamento antes do aceite e acesso à localização de outras corridas.

## Dados e privacidade

A tabela `rides` receberá latitude, longitude e horário da última posição do motorista, além de um token público aleatório e único para acompanhamento. O token é criado quando o pedido é criado, mas só retorna localização se a corrida estiver ativa e o motorista tiver enviado uma posição.

O token não é uma credencial do motorista e não permite alterar dados. A API pública nunca retorna a última posição para corridas `requested`, `completed` ou `cancelled`, mesmo que coordenadas antigas estejam persistidas.

## Fluxo

1. O passageiro cria o pedido pelo link público e recebe a URL de acompanhamento da corrida.
2. O motorista aceita o pedido; o Cockpit ativa o compartilhamento de localização, condicionado à permissão do navegador.
3. Enquanto estiver em `accepted` ou `in_progress`, o Cockpit envia a posição atual periodicamente para a API autenticada.
4. A página pública consulta o estado e a posição a cada cinco segundos e desenha o motorista no mapa.
5. Ao concluir ou cancelar, o Cockpit interrompe o envio e a API pública deixa de responder com a localização.

## Interface

No Cockpit, a corrida aceita ou em andamento mostra o estado “Compartilhando localização com o passageiro”. Se o GPS não estiver autorizado ou indisponível, o motorista recebe uma mensagem clara sem impedir as demais ações da corrida.

No link público, a página de confirmação leva à tela “Acompanhar corrida”, com mapa, status “Motorista a caminho” ou “Em viagem” e atualização automática. Sem posição válida, ela apresenta “Aguardando localização do motorista”; corrida encerrada mostra mensagem de encerramento e não mantém mapa ou coordenadas visíveis.

## API

Rotas autenticadas do motorista atualizam a posição somente da corrida pertencente a ele e ativa. Uma rota pública, protegida pelo token da corrida, retorna o status público e a última posição somente para `accepted` e `in_progress`.

## Testes

Cobrir criação do token, atualização autorizada de posição, recusa para corrida de outro motorista ou estado inativo, leitura pública por token válido, ausência de coordenadas antes da primeira atualização e não exposição após concluir/cancelar.
