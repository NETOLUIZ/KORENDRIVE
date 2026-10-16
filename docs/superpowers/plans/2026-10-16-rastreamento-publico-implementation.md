# Rastreamento Público da Corrida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o passageiro acompanhe a posição atual do motorista no link público, somente entre o aceite e o fim da corrida.

**Architecture:** `rides` armazenará o token público e a última posição. O Cockpit autenticado enviará posição somente para uma corrida ativa do próprio motorista; a rota pública devolverá estado e coordenadas só para token válido em `accepted` ou `in_progress`. A página pública consultará essa rota a cada cinco segundos.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, HTML, JavaScript, MapLibre e `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-16-rastreamento-publico-design.md`

## Global Constraints

- Compartilhar localização somente em `accepted` e `in_progress`.
- Token público só pode ler a própria corrida; nunca permite alteração.
- Corridas `requested`, `completed` e `cancelled` nunca expõem coordenadas.
- Não adicionar dependências ou WebSockets.

## Review Focus

- Token inválido retorna 404 sem revelar se uma corrida existe — teste na Task 2.
- Motorista não pode atualizar a posição de corrida alheia — teste na Task 2.
- GPS indisponível não impede aceitar, iniciar, concluir ou cancelar — teste na Task 3.
- Uma posição antiga não aparece depois de concluir/cancelar — teste na Task 2.
- Polling não deve criar múltiplos timers ao navegar/recarregar — teste na Task 3.

---

### Task 1: Persistência e token público da corrida

**Files:**
- Modify: `server/schema.sql: migrações de rides`
- Modify: `server/routes/public.js: criação de pedido`
- Test: `test/ride-tracking-schema.test.mjs`

**Interfaces:**
- Produces: `rides.tracking_token`, `driver_lat`, `driver_lng`, `driver_location_at`; resposta do pedido com `tracking_token` e URL pública.

- [ ] **Step 1: Escrever teste falho para campos de rastreamento, token único e retorno do token no pedido público.**
- [ ] **Step 2: Rodar `node --test test/ride-tracking-schema.test.mjs` e confirmar FAIL.**
- [ ] **Step 3: Adicionar migrações idempotentes e gerar `crypto.randomBytes` token único na criação em `server/routes/public.js`.**
- [ ] **Step 4: Rodar o teste e `npm test`; confirmar PASS.**
- [ ] **Step 5: Commit.**

### Task 2: API privada de posição e leitura pública restrita

**Files:**
- Modify: `server/routes/rides.js: PATCH /rides/:id/location`
- Modify: `server/routes/public.js: GET /tracking/:token`
- Test: `test/ride-tracking-routes.test.mjs`

**Interfaces:**
- Consumes: token e colunas da Task 1.
- Produces: `api.updateRideLocation(id, latitude, longitude)` e payload público `{ status, driver_location }`.

- [ ] **Step 1: Escrever testes falhos para atualização autorizada, recusa de estado/corrida alheia, token inválido e ocultação após conclusão/cancelamento.**
- [ ] **Step 2: Rodar `node --test test/ride-tracking-routes.test.mjs` e confirmar FAIL.**
- [ ] **Step 3: Implementar as duas rotas com validação de coordenadas, queries parametrizadas e 404 para token inválido/inativo.**
- [ ] **Step 4: Rodar o teste e `npm test`; confirmar PASS.**
- [ ] **Step 5: Commit.**

### Task 3: Cockpit e tela pública de acompanhamento

**Files:**
- Modify: `public/js/api.js: updateRideLocation(id, latitude, longitude)`
- Modify: `public/js/app.js: ciclo de geolocalização por corrida ativa`
- Modify: `public/booking.html` e `public/js/booking.js: tela de acompanhamento, mapa e polling`
- Test: `test/ride-tracking-ui.test.mjs`

**Interfaces:**
- Consumes: endpoints da Task 2 e token retornado ao criar o pedido.
- Produces: `startRideLocationSharing(rideId)`, `stopRideLocationSharing()`, `startTracking(token)` e UI de status.

- [ ] **Step 1: Escrever teste falho para métodos do cliente, tela de acompanhamento e limpeza do polling.**
- [ ] **Step 2: Rodar `node --test test/ride-tracking-ui.test.mjs` e confirmar FAIL.**
- [ ] **Step 3: Implementar captura periódica no Cockpit após aceite/início e interrupção em concluir/cancelar, sem bloquear ações se GPS falhar.**
- [ ] **Step 4: Implementar tela pública que lê o token da URL, consulta a cada cinco segundos, desenha a posição no mapa e mostra estados de espera/encerramento.**
- [ ] **Step 5: Rodar o teste e `npm test`; confirmar PASS.**
- [ ] **Step 6: Verificar manualmente no navegador: pedido → aceite → mapa → início → conclusão, e confirmar que o token não retorna posição após encerrar.**
- [ ] **Step 7: Commit.**

### Task 4: Verificação final

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-rastreamento-publico-design.md` somente se a implementação revelar decisão necessária.

- [ ] **Step 1: Executar `npm test` e `git diff --check`; ambos devem passar.**
- [ ] **Step 2: Conferir manualmente que as respostas públicas não contêm coordenadas de corrida inativa.**
- [ ] **Step 3: Commit de documentação, apenas se necessário.**
