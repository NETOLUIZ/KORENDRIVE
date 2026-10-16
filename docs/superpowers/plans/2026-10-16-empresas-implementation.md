# Gestão de Empresas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar no painel do Super Admin um módulo de Empresas que cadastre uma empresa e seu único administrador, permita gestão e apresente seus motoristas vinculados.

**Architecture:** Uma tabela `companies` será a fonte dos dados comerciais e terá `admin_id` único. As rotas em `superadmin.js` executam operações na transação já aberta por `withDbContext`; os motoristas continuam ligados a `admins`, e a consulta da empresa os obtém por esse administrador. A tela existente deixa de usar o placeholder de Empresas e consome a API por meio de `superadmin-api.js`.

**Tech Stack:** Node.js ESM, Express, PostgreSQL, node-postgres, HTML/Tailwind via CDN, JavaScript do navegador e `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-16-empresas-design.md`

## Global Constraints

- Cada empresa possui exatamente um administrador responsável e cada administrador pode ser responsável por no máximo uma empresa.
- CNPJ é opcional; nome, telefone, e-mail, endereço, plano, mensalidade e credenciais do administrador são obrigatórios.
- Cadastro deve ser atômico, autenticado por `requireSuperAdmin`, e não pode expor hash ou salt de senha.
- Bloquear/desbloquear uma empresa deve atualizar, na mesma transação, seu administrador responsável.
- Motoristas permanecem vinculados pelo `drivers.admin_id`; não criar um segundo vínculo de propriedade.
- Não adicionar dependências.

## Review Focus

- E-mail de administrador já existente deve retornar erro e não deixar empresa criada — teste na Task 2.
- CNPJ ausente deve ser aceito, mas CNPJ não numérico/fora de 14 dígitos deve ser rejeitado — teste na Task 2.
- Um administrador já vinculado a outra empresa não pode ser reutilizado — teste na Task 2.
- Falha no segundo `INSERT` deve reverter a criação da empresa e do administrador — teste na Task 2 usando o mesmo `req.db` transacional.
- Bloqueio/desbloqueio deve manter os status de empresa e administrador sincronizados — teste na Task 2.

---

### Task 1: Persistência de empresas e compatibilidade dos dados existentes

**Files:**

- Modify: `server/schema.sql: após CREATE TABLE admins`
- Test: `test/schema-companies.test.mjs`

**Interfaces:**

- Produces: tabela `companies(id, name, cnpj, phone, email, address, plan, monthly_fee, status, admin_id, created_at, updated_at)`; `admin_id UNIQUE REFERENCES admins(id)`.
- Consumes: colunas existentes de `admins` e `drivers.admin_id`.

- [ ] **Step 1: Escrever o teste que lê `server/schema.sql` e exige `companies`, `admin_id UNIQUE`, campos obrigatórios, CNPJ anulável e os valores `active`/`blocked`.**
- [ ] **Step 2: Executar `node --test test/schema-companies.test.mjs` e confirmar que falha porque o schema ainda não declara `companies`.**
- [ ] **Step 3: Criar a tabela e índices em `server/schema.sql`.** Use `CREATE TABLE IF NOT EXISTS companies`, `NUMERIC(10,2)` para mensalidade, `CHECK` para status, `UNIQUE(admin_id)`, e um `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para `updated_at` quando necessário. Inclua um backfill idempotente que crie empresas para admins com `role = 'admin'` e `company_name` não vazio, sem duplicar empresas já vinculadas.
- [ ] **Step 4: Executar `node --test test/schema-companies.test.mjs` e confirmar PASS.**
- [ ] **Step 5: Commit.** Execute `git add server/schema.sql test/schema-companies.test.mjs` e `git commit -m "feat: adiciona persistência de empresas"`.

### Task 2: API segura de Empresas

**Files:**

- Modify: `server/routes/superadmin.js: helpers e rotas antes de /logout`
- Test: `test/superadmin-companies.test.mjs`

**Interfaces:**

- Consumes: `req.db` fornecido por `withDbContext`, `hashPassword`, `generateInviteToken(db)` e administrador autenticado por `requireSuperAdmin`.
- Produces: `GET /api/superadmin/companies`, `POST /api/superadmin/companies`, `GET /api/superadmin/companies/:id`, `PATCH /api/superadmin/companies/:id`, `PATCH /api/superadmin/companies/:id/status`.

- [ ] **Step 1: Escrever testes de rota com um `req.db.query` controlado.** Cubra criação válida com CNPJ `null`; ausência de cada campo obrigatório; CNPJ inválido; e-mail duplicado; administrador já ligado; listagem com `driver_count`; detalhe com motoristas daquele administrador; edição; e atualização sincronizada de `companies.status` e `admins.status`. Asserte que objetos de resposta não têm `password_hash` nem `password_salt`.
- [ ] **Step 2: Executar `node --test test/superadmin-companies.test.mjs` e confirmar FAIL pelas rotas/exportações inexistentes.**
- [ ] **Step 3: Implementar helpers de validação e as cinco rotas em `server/routes/superadmin.js`.** `POST` deve validar o payload `{ company: { name, cnpj, phone, email, address, plan, monthly_fee }, admin: { name, email, password } }`, inserir `admins` e `companies` por `req.db` e retornar `{ success: true, company }`. A listagem deve incluir o administrador, `driver_count` e a mensalidade. O detalhe deve retornar a empresa, administrador sanitizado e motoristas. Use queries parametrizadas e responda 404 para IDs ausentes.
- [ ] **Step 4: Executar `node --test test/superadmin-companies.test.mjs` e confirmar PASS.**
- [ ] **Step 5: Executar `npm test` e confirmar PASS.**
- [ ] **Step 6: Commit.** Execute `git add server/routes/superadmin.js test/superadmin-companies.test.mjs` e `git commit -m "feat: adiciona API de empresas"`.

### Task 3: Cliente HTTP e estrutura visual do módulo Empresas

**Files:**

- Modify: `public/js/superadmin-api.js: objeto superadminApi`
- Modify: `public/superadmin.html: substituir page-placeholder somente para empresas; adicionar modal de cadastro e detalhe`
- Test: `test/superadmin-companies-ui.test.mjs`

**Interfaces:**

- Consumes: endpoints da Task 2.
- Produces: `superadminApi.listCompanies()`, `createCompany(payload)`, `getCompany(id)`, `updateCompany(id, payload)`, `setCompanyStatus(id, status)` e elementos HTML com IDs `page-empresas`, `form-company`, `companies-table-body`, `modal-company-detail`.

- [ ] **Step 1: Escrever o teste estático que confirma a presença dos elementos e do fluxo de formulário acima, além dos cinco métodos no cliente da API.**
- [ ] **Step 2: Executar `node --test test/superadmin-companies-ui.test.mjs` e confirmar FAIL.**
- [ ] **Step 3: Adicionar os métodos do cliente em `public/js/superadmin-api.js`.** Todos usam `authFetch`, serializam JSON e retornam `{ ok: res.ok, ...data }`, seguindo os métodos existentes.
- [ ] **Step 4: Substituir o placeholder exclusivo de Empresas por uma página responsiva em `public/superadmin.html`.** Incluir quatro indicadores, busca, botão **Nova empresa**, tabela (empresa, administrador, plano, motoristas, mensalidade, status e ações), formulário em três etapas (Empresa, Administrador, Plano/revisão) e modal/painel de detalhe com edição e bloqueio/desbloqueio. Manter os placeholders das demais páginas intactos.
- [ ] **Step 5: Executar `node --test test/superadmin-companies-ui.test.mjs` e confirmar PASS.**
- [ ] **Step 6: Commit.** Execute `git add public/superadmin.html public/js/superadmin-api.js test/superadmin-companies-ui.test.mjs` e `git commit -m "feat: adiciona interface de empresas"`.

### Task 4: Controlador da tela Empresas

**Files:**

- Modify: `public/js/superadmin.js: state, exports globais, navigateSA e funções de Empresas`
- Test: `test/superadmin-companies-ui.test.mjs`

**Interfaces:**

- Consumes: elementos e IDs da Task 3; os cinco métodos `superadminApi` da Task 3.
- Produces: `loadCompanies()`, `renderCompaniesPage()`, `handleCreateCompany(event)`, `openCompanyDetail(id)`, `handleCompanyStatus(id, status)` e navegação funcional para `empresas`.

- [ ] **Step 1: Estender o teste de UI para exigir que navegar a `empresas` carregue e renderize a listagem e que o submit use `createCompany` com o payload aninhado da API.**
- [ ] **Step 2: Executar `node --test test/superadmin-companies-ui.test.mjs` e confirmar FAIL.**
- [ ] **Step 3: Implementar o estado e funções da tela em `public/js/superadmin.js`.** Carregue empresas ao exibir o dashboard e ao navegar para Empresas; filtre localmente por nome, administrador ou e-mail. No sucesso do cadastro, feche/reinicie o formulário, mostre toast, recarregue indicadores/tabela e atualize Dashboard e Administradores. Para erros da API, mostre a mensagem retornada sem perder os valores digitados. O detalhe deve exibir os motoristas retornados pela API e as ações de status devem recarregar o detalhe e a tabela.
- [ ] **Step 4: Ajustar `navigateSA(page)` para mostrar `page-empresas` apenas para Empresas e continuar usando `page-placeholder` para Assinaturas, Pagamentos, Relatórios e Configurações.**
- [ ] **Step 5: Executar `node --test test/superadmin-companies-ui.test.mjs` e depois `npm test`; confirmar PASS em ambos.**
- [ ] **Step 6: Fazer a verificação manual no navegador.** Inicie com `npm start`, autentique como Super Admin, crie uma empresa sem CNPJ, confirme-a na tabela e detalhe, confira o vínculo do administrador e bloqueie/desbloqueie. Teste também um e-mail já usado e a busca.
- [ ] **Step 7: Commit.** Execute `git add public/js/superadmin.js test/superadmin-companies-ui.test.mjs` e `git commit -m "feat: conecta gestão de empresas ao painel"`.

### Task 5: Verificação final e documentação do comportamento entregue

**Files:**

- Modify: `docs/superpowers/specs/2026-10-16-empresas-design.md: apenas se houver decisão implementada que precise ser explicitada`

**Interfaces:**

- Consumes: entregas das Tasks 1–4.
- Produces: evidência de testes e uma árvore de trabalho limpa.

- [ ] **Step 1: Executar `npm test` e confirmar PASS.**
- [ ] **Step 2: Executar `git diff --check` e confirmar que não há erros de whitespace.**
- [ ] **Step 3: Revisar as respostas das rotas para garantir que não expõem hashes, nem permitem outro administrador para a mesma empresa, e que as mensagens de validação estão em português claro.**
- [ ] **Step 4: Executar `git status --short` e confirmar que não existem alterações não versionadas.**
- [ ] **Step 5: Commit, se a documentação mudou.** Execute `git add docs/superpowers/specs/2026-10-16-empresas-design.md` e `git commit -m "docs: registra comportamento de empresas"`.
