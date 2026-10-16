# Gestão de Empresas no Super Admin

## Objetivo

Criar um módulo de Empresas no painel do Super Admin. O módulo permitirá cadastrar, consultar, editar e controlar empresas clientes da plataforma, cada uma com exatamente um administrador responsável. Depois do cadastro, o administrador da empresa gerencia os próprios motoristas.

## Escopo

O Super Admin poderá:

- cadastrar uma empresa e o administrador responsável em uma única operação;
- listar, pesquisar e abrir o detalhe das empresas;
- editar os dados cadastrais, plano e mensalidade;
- visualizar o administrador responsável e os motoristas vinculados;
- bloquear e desbloquear uma empresa.

O cadastro deve exigir nome da empresa, telefone, e-mail, endereço, plano, mensalidade e os dados de acesso do administrador. CNPJ é opcional.

Ficam fora deste incremento múltiplos administradores por empresa, permissões entre administradores e cobrança integrada por provedor externo.

## Modelo de dados

Será criada a entidade `companies` com os dados:

- identificador;
- nome;
- CNPJ opcional;
- telefone;
- e-mail;
- endereço;
- plano;
- mensalidade;
- status (`active` ou `blocked`);
- identificador único do administrador responsável;
- criação e atualização.

O vínculo `companies.admin_id` será único: uma empresa tem um administrador e um administrador só pode ser responsável por uma empresa. Os motoristas continuam relacionados ao administrador; a empresa os obtém pelo administrador responsável. Essa escolha evita duplicar o vínculo de propriedade dos motoristas neste primeiro incremento.

Para compatibilidade, os administradores existentes que já possuírem `company_name` poderão receber uma empresa correspondente durante a migração, sem perder os dados atuais.

## Fluxos

### Cadastro

1. O Super Admin seleciona **Nova empresa**.
2. Informa os dados da empresa: nome, CNPJ opcional, telefone, e-mail e endereço.
3. Informa os dados de acesso do único administrador responsável.
4. Escolhe plano e mensalidade, revisa as informações e confirma.
5. A API cria empresa e administrador dentro de uma transação e retorna o registro criado.

Se qualquer validação ou gravação falhar, a transação é revertida: não haverá empresa sem administrador, nem administrador sem empresa criado por esse fluxo.

### Gestão

A listagem exibirá empresa, administrador responsável, plano, quantidade de motoristas, mensalidade e status. O detalhe exibirá os dados completos, o administrador e a lista de motoristas vinculados.

Bloquear uma empresa bloqueará simultaneamente o administrador responsável; desbloquear ambos restaurará o acesso. A alteração de plano ou mensalidade será a fonte para as futuras telas de Assinaturas e Pagamentos.

## Interface

A tela **Empresas** substituirá o placeholder atual do Super Admin e conterá:

- indicadores de empresas ativas, bloqueadas, motoristas vinculados e receita mensal;
- campo de busca e botão **Nova empresa**;
- tabela responsiva com status e ações;
- formulário em etapas: Empresa, Administrador e Plano/revisão;
- tela ou painel de detalhe com edição e bloqueio/desbloqueio.

O novo módulo reutilizará os componentes visuais existentes do painel: cartões, tabelas, badges, botões, modais e notificações.

## API

Serão adicionadas rotas protegidas por `requireSuperAdmin` para listar, criar, consultar, atualizar e alterar o status de empresas. A criação validará campos obrigatórios, e-mail único do administrador, CNPJ quando presente, telefone e endereço. A resposta de erro deverá ser amigável e não expor informações sensíveis.

## Testes

Os testes devem cobrir criação válida, ausência de campos obrigatórios, CNPJ opcional, e-mail duplicado, criação atômica, unicidade do administrador por empresa, listagem com contagem de motoristas e bloqueio/desbloqueio sincronizado entre empresa e administrador.
