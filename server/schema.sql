-- Schema PostgreSQL do korenDriver, com Row-Level Security.
-- Aplicado de forma idempotente na inicialização (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  company_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  invite_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  payment_status TEXT NOT NULL DEFAULT 'em_dia' CHECK (payment_status IN ('em_dia', 'inadimplente')),
  monthly_fee NUMERIC(10,2) NOT NULL DEFAULT 99.90,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  plan TEXT NOT NULL,
  monthly_fee NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  admin_id INTEGER NOT NULL UNIQUE REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);

INSERT INTO companies (name, phone, email, address, plan, monthly_fee, status, admin_id)
SELECT a.company_name, '', a.email, '', 'Padrão', a.monthly_fee, a.status, a.id
FROM admins a
WHERE a.role = 'admin'
  AND NULLIF(BTRIM(a.company_name), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.admin_id = a.id);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cpf TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  address TEXT,
  cnh_front TEXT,
  cnh_back TEXT,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  -- Motorista novo começa zerado — sem corrida, sem nota, sem categoria.
  -- Esses valores eram os mesmos dados de demonstração (seedData), e todo
  -- cadastro novo nascia com a nota/categoria/ganhos fake do motorista fictício.
  rating NUMERIC(3,2),
  category TEXT DEFAULT 'Novato',
  acceptance_rate NUMERIC(5,2) DEFAULT 0,
  cancellation_rate NUMERIC(5,2) DEFAULT 0,
  today_earnings NUMERIC(10,2) DEFAULT 0,
  today_rides INTEGER DEFAULT 0,
  today_hours TEXT DEFAULT '0h 00m',
  km_driven NUMERIC(10,2) DEFAULT 0,
  fuel_efficiency NUMERIC(5,2),
  admin_id INTEGER REFERENCES admins(id),
  can_edit_rates BOOLEAN NOT NULL DEFAULT true,
  can_share_direct_link BOOLEAN NOT NULL DEFAULT true,
  public_slug TEXT UNIQUE,
  -- Prova de consentimento LGPD (Art. 8º): quando e qual versão dos Termos/
  -- Política o motorista aceitou de fato, não um checkbox decorativo.
  terms_version TEXT,
  terms_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drivers_admin_id ON drivers(admin_id);

-- Migração idempotente: a tabela já existia antes desses dois campos serem
-- criados, e "CREATE TABLE IF NOT EXISTS" não adiciona coluna em tabela já
-- existente — Postgres suporta ADD COLUMN IF NOT EXISTS nativamente.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Corrige os DEFAULTs das colunas acima: a tabela já existia com os valores de
-- demonstração (nota 4.96, categoria Diamante, R$284,50 etc) como DEFAULT, e
-- "CREATE TABLE IF NOT EXISTS" não reaplica a definição de coluna em banco já
-- criado — só um ALTER COLUMN muda o DEFAULT pros próximos cadastros.
ALTER TABLE drivers ALTER COLUMN rating DROP DEFAULT;
ALTER TABLE drivers ALTER COLUMN category SET DEFAULT 'Novato';
ALTER TABLE drivers ALTER COLUMN acceptance_rate SET DEFAULT 0;
ALTER TABLE drivers ALTER COLUMN cancellation_rate SET DEFAULT 0;
ALTER TABLE drivers ALTER COLUMN today_earnings SET DEFAULT 0;
ALTER TABLE drivers ALTER COLUMN today_rides SET DEFAULT 0;
ALTER TABLE drivers ALTER COLUMN today_hours SET DEFAULT '0h 00m';
ALTER TABLE drivers ALTER COLUMN km_driven SET DEFAULT 0;
ALTER TABLE drivers ALTER COLUMN fuel_efficiency DROP DEFAULT;

-- Aprovação de motorista: todo cadastro novo nasce 'pending' e só ganha acesso
-- ao Cockpit depois de aprovado — pelo admin da empresa (se admin_id setado) ou
-- pelo super admin (se motorista independente). Backfill ANTES do DEFAULT: sem
-- isso, motoristas já ativos (seed de demo + contas reais já em produção)
-- virariam 'pending' retroativamente e perderiam acesso no próximo boot.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS approval_status TEXT;
UPDATE drivers SET approval_status = 'approved' WHERE approval_status IS NULL;
ALTER TABLE drivers ALTER COLUMN approval_status SET DEFAULT 'pending';
ALTER TABLE drivers ALTER COLUMN approval_status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE drivers ADD CONSTRAINT drivers_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Data da última corrida que atualizou today_earnings/today_rides/km_driven —
-- é o que permite "hoje" virar "zero" de novo sozinho no primeiro corrida do
-- dia seguinte, sem precisar de um job de reset rodando à meia-noite.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS today_stats_date DATE DEFAULT CURRENT_DATE;

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  color TEXT NOT NULL,
  fuel_type TEXT NOT NULL,
  photo_url TEXT,
  crlv_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id ON vehicles(driver_id);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  date_time TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_driver_id ON expenses(driver_id);

CREATE TABLE IF NOT EXISTS driver_rates (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL UNIQUE REFERENCES drivers(id) ON DELETE CASCADE,
  base_fare NUMERIC(10,2) DEFAULT 6.50,
  km_rate NUMERIC(10,2) DEFAULT 2.75,
  minute_rate NUMERIC(10,2) DEFAULT 0.45,
  min_fare NUMERIC(10,2) DEFAULT 15.00,
  pix_key TEXT
);

CREATE TABLE IF NOT EXISTS rides (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  passenger_name TEXT NOT NULL,
  passenger_phone TEXT,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance_km NUMERIC(10,2) NOT NULL,
  duration_min INTEGER NOT NULL,
  fare NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('requested', 'in_progress', 'completed', 'cancelled')),
  date_time TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_created ON rides(driver_id, created_at);

-- Ciclo de vida real da corrida (pedido do passageiro → aceite → em
-- andamento → concluída), além do log manual que já existia. Coordenadas
-- servem pro botão de navegação (Waze) usar a origem exata escolhida.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS origin_lat NUMERIC(10,7);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS origin_lng NUMERIC(10,7);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_lat NUMERIC(10,7);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS destination_lng NUMERIC(10,7);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS tracking_token TEXT UNIQUE;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_lat NUMERIC(10,7);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_lng NUMERIC(10,7);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_location_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_rides_tracking_token ON rides(tracking_token);

-- 'accepted' é o estado entre "pedido recebido" e "corrida em andamento" —
-- motorista já confirmou mas ainda não apertou Iniciar Corrida.
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE rides ADD CONSTRAINT rides_status_check
  CHECK (status IN ('requested', 'accepted', 'in_progress', 'completed', 'cancelled'));

-- Uma tabela de sessão só, serve motorista e admin/super admin (CHECK garante que é sempre só um dono)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  CONSTRAINT sessions_one_owner CHECK (
    (admin_id IS NOT NULL AND driver_id IS NULL) OR (admin_id IS NULL AND driver_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin_id ON sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_driver_id ON sessions(driver_id);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
-- FORCE é obrigatório: por padrão o Postgres ignora RLS pra quem é dono da
-- tabela (o usuário que rodou este script normalmente é o dono), então sem
-- FORCE as políticas abaixo existiriam só no papel.

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE driver_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides FORCE ROW LEVEL SECURITY;

-- DROP + CREATE (em vez de "criar só se não existir") de propósito: assim,
-- qualquer alteração feita aqui neste arquivo passa a valer no próximo boot,
-- sem depender de resetar o banco pra uma política editada ter efeito.

DROP POLICY IF EXISTS drivers_self ON drivers;
CREATE POLICY drivers_self ON drivers FOR ALL
  USING (id = NULLIF(current_setting('app.current_driver_id', true), '')::int);

DROP POLICY IF EXISTS drivers_admin_scoped ON drivers;
CREATE POLICY drivers_admin_scoped ON drivers FOR ALL
  USING (admin_id = NULLIF(current_setting('app.current_admin_id', true), '')::int);

DROP POLICY IF EXISTS drivers_super_admin ON drivers;
CREATE POLICY drivers_super_admin ON drivers FOR SELECT
  USING (current_setting('app.current_role', true) = 'super_admin');

-- Super admin só tinha SELECT acima — sem isso, o UPDATE de aprovar/rejeitar
-- motorista independente (sem admin_id) afetaria 0 linhas sob RLS.
DROP POLICY IF EXISTS drivers_super_admin_update ON drivers;
CREATE POLICY drivers_super_admin_update ON drivers FOR UPDATE
  USING (current_setting('app.current_role', true) = 'super_admin');

-- Ver nota em drivers_login_lookup: esse mesmo mecanismo de flag serve a tela
-- pública de solicitação (/api/public/driver/:slug). Sem a flag, mesmo um
-- motorista com o link compartilhável ligado não aparece pra ninguém — a
-- condição de negócio (public_slug + can_share_direct_link) continua exigida
-- mesmo com a flag ativa, então o bypass nunca expõe motorista bloqueado/oculto.
DROP POLICY IF EXISTS drivers_public_link ON drivers;
CREATE POLICY drivers_public_link ON drivers FOR SELECT
  USING (
    current_setting('app.bypass_public_rls', true) = 'true'
    AND public_slug IS NOT NULL
    AND can_share_direct_link = true
    AND approval_status = 'approved'
  );

DROP POLICY IF EXISTS drivers_public_insert ON drivers;
CREATE POLICY drivers_public_insert ON drivers FOR INSERT WITH CHECK (true);

-- Login precisa localizar o motorista pelo e-mail/CPF/telefone ANTES de qualquer
-- identidade existir (é exatamente isso que a senha vai confirmar). Esse escape só
-- é ativado pelo próprio código do servidor, na única query de login, dentro da
-- mesma transação — nunca é algo que o cliente possa setar.
DROP POLICY IF EXISTS drivers_login_lookup ON drivers;
CREATE POLICY drivers_login_lookup ON drivers FOR SELECT
  USING (current_setting('app.bypass_login_rls', true) = 'true');

DROP POLICY IF EXISTS vehicles_self ON vehicles;
CREATE POLICY vehicles_self ON vehicles FOR ALL
  USING (driver_id = NULLIF(current_setting('app.current_driver_id', true), '')::int);

-- vehicles não tinha NENHUMA política pra admin/super admin — sem isso, nenhum
-- dos dois consegue ver foto do veículo/CRLV pra revisar documento no cadastro.
DROP POLICY IF EXISTS vehicles_admin_scoped ON vehicles;
CREATE POLICY vehicles_admin_scoped ON vehicles FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE admin_id = NULLIF(current_setting('app.current_admin_id', true), '')::int));

DROP POLICY IF EXISTS vehicles_super_admin ON vehicles;
CREATE POLICY vehicles_super_admin ON vehicles FOR SELECT
  USING (current_setting('app.current_role', true) = 'super_admin');

DROP POLICY IF EXISTS vehicles_public_link ON vehicles;
CREATE POLICY vehicles_public_link ON vehicles FOR SELECT
  USING (
    current_setting('app.bypass_public_rls', true) = 'true'
    AND driver_id IN (SELECT id FROM drivers WHERE public_slug IS NOT NULL AND can_share_direct_link = true AND approval_status = 'approved')
  );

DROP POLICY IF EXISTS driver_rates_self ON driver_rates;
CREATE POLICY driver_rates_self ON driver_rates FOR ALL
  USING (driver_id = NULLIF(current_setting('app.current_driver_id', true), '')::int);

DROP POLICY IF EXISTS driver_rates_public_link ON driver_rates;
CREATE POLICY driver_rates_public_link ON driver_rates FOR SELECT
  USING (
    current_setting('app.bypass_public_rls', true) = 'true'
    AND driver_id IN (SELECT id FROM drivers WHERE public_slug IS NOT NULL AND can_share_direct_link = true AND approval_status = 'approved')
  );

DROP POLICY IF EXISTS expenses_self ON expenses;
CREATE POLICY expenses_self ON expenses FOR ALL
  USING (driver_id = NULLIF(current_setting('app.current_driver_id', true), '')::int);

DROP POLICY IF EXISTS rides_self ON rides;
CREATE POLICY rides_self ON rides FOR ALL
  USING (driver_id = NULLIF(current_setting('app.current_driver_id', true), '')::int);

-- Passageiro (anônimo) solicitando corrida pelo link público — mesma lógica
-- de bypass + condição de negócio já usada em drivers_public_link, pra
-- garantir que só dá pra criar pedido pra motorista aprovado e com o link
-- compartilhável ligado (nunca pra motorista pendente/rejeitado/oculto).
DROP POLICY IF EXISTS rides_public_insert ON rides;
CREATE POLICY rides_public_insert ON rides FOR INSERT
  WITH CHECK (
    current_setting('app.bypass_public_rls', true) = 'true'
    AND driver_id IN (
      SELECT id FROM drivers
      WHERE public_slug IS NOT NULL AND can_share_direct_link = true AND approval_status = 'approved'
    )
  );

DROP POLICY IF EXISTS rides_public_tracking ON rides;
CREATE POLICY rides_public_tracking ON rides FOR SELECT
  USING (current_setting('app.bypass_public_rls', true) = 'true' AND tracking_token IS NOT NULL);
