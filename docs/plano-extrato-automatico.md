# Extrato bancário automático no Entur OS FIN, com custo variável zero

Documento de planejamento. Nenhuma linha de código de produção foi escrita nesta etapa.
Alvo confirmado com o Bruno: **Entur OS FIN**, aplicação `grupos-os-app` no Coolify `187.127.6.135:8000`, repositório `papodeagente/financeiro-os`.

---

## 0. Conflitos entre o enunciado e o repositório

O enunciado descreve uma stack que **não é a deste repositório**. Ela corresponde ao `entur-os-crm`, que é outro produto. Antes de qualquer decisão, os conflitos:

| Enunciado afirma | Realidade do `financeiro-os` | Evidência |
|---|---|---|
| tRPC, `tenantProcedure`, `getTenantId(ctx)` | Não existe tRPC. Rotas são Route Handlers do App Router. O tenant vem de `getTenantId()` sem `ctx` | `src/lib/tenant.ts:4` |
| Drizzle ORM | Não existe ORM. SQL direto com `pg` | `package.json` sem `drizzle-orm`; `src/lib/db.ts` |
| MySQL / TiDB | PostgreSQL | `src/lib/db.ts:3` usa `new Pool` do `pg` |
| BullMQ, Redis | Não existem. Nenhuma fila, nenhum worker, nenhum job repetível | `package.json` sem `bullmq` nem `ioredis` |
| Socket.IO | Não existe | `package.json` |
| `EventLog` | Não existe com esse nome. Existe `audit_log` servido pelo CRUD genérico | `src/lib/db.ts:204`, `src/app/api/audit-log/route.ts:2` |
| Tokens de Clicksign e Z API para reaproveitar padrão de cifra | Nenhum dos dois existe aqui. **Não existe nenhuma rotina de criptografia no projeto** | busca por `createCipheriv`, `AES`, `crypto.subtle.encrypt` em `src/lib`: zero ocorrências |
| Falta a entrada do extrato e a conciliação | **Parte já existe.** Tabela `extrato_bancario`, importação de OFX e CSV com deduplicação, e tela de conciliação com sugestão automática | `src/lib/db.ts:151`, `src/app/api/conciliacao/importar/route.ts`, `src/app/financeiro-ag/conciliacao/page.tsx` |

**Ajuste proposto ao escopo.** O Modo A não é para construir, é para **reaproveitar**: ele está pronto e funcionando. O trabalho real desta rodada é o Modo B, mais três lacunas que o Modo B expõe e que hoje não existem: cifra de segredo, agendamento e estado de conexão.

Duas premissas do enunciado caem por terra e mudam o plano:

1. Não há fila. Agendamento precisa ser decidido do zero, não configurado numa infraestrutura existente.
2. Não há cifra. A chave privada da agência é o dado mais sensível que este produto vai guardar e não há padrão anterior para copiar.

---

## 1. Achados da investigação no repositório

### 1.1 Modelagem do Financeiro

O projeto **não usa colunas por campo**. Toda entidade é uma linha com `id`, algumas colunas indexadas e um `data JSONB` com o objeto inteiro. Exemplo real, `src/lib/db.ts:151`:

```
CREATE TABLE IF NOT EXISTS extrato_bancario (
  id TEXT PRIMARY KEY,
  conta_bancaria_id TEXT NOT NULL DEFAULT '',
  status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Tabelas do domínio financeiro, todas nesse formato: `contas_receber`, `contas_pagar`, `contas_bancarias`, `extrato_bancario`, `transferencias`, `plano_contas`, `centros_custo`, `cartoes_corp`, `comissoes`, `planos_comissao`.

O formato dos objetos está em `src/lib/crm-types.ts`. O de extrato, em `crm-types.ts:515`, já contempla conciliação:

```
export interface ExtratoLinha {
  id: string;
  conta_bancaria_id: string;
  data: string;              // 'YYYY-MM-DD'
  descricao: string;
  valor: number;             // positivo = crédito, negativo = débito
  tipo: 'CREDITO' | 'DEBITO';
  saldo: number;
  status_conciliacao: StatusConciliacao;
  lancamento_vinculado_id: string | null;
  lancamento_vinculado_tipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | 'TRANSFERENCIA' | null;
  observacao_conciliacao: string;
  importado_em: string;
  arquivo_origem: string;
}
```

**Consequência para o plano.** O extrato coletado por API entra nessa mesma estrutura. Nenhuma tabela nova de transação é necessária. O campo `arquivo_origem` passa a comportar também a origem "sincronização automática", e é ele que distingue as duas procedências.

### 1.2 Isolamento multi tenant

`getTenantId()` lê o tenant da sessão, nunca do input, e lança se não houver contexto (`src/lib/tenant.ts:4`):

```
export async function getTenantId(): Promise<string> {
  const session = await getSession();
  if (session?.impersonatingTenantId) return session.impersonatingTenantId;
  if (session?.tenantId) return session.tenantId;
  throw new Error('No tenant context');
}
```

O CRUD genérico (`src/lib/crud-api.ts`) filtra por `tenant_id` em todo SELECT, UPDATE e DELETE, e o upsert tem guarda contra sobrescrever registro de outro tenant (`crud-api.ts:52`):

```
WHERE ${tableName}.tenant_id = EXCLUDED.tenant_id
```

**Lacuna encontrada.** As tabelas financeiras **não têm índice iniciado por `tenant_id`**. Só `support_tickets`, `support_ticket_messages` e algumas de negociação têm (`src/lib/db.ts:256`, `260`). Em `extrato_bancario` isso é aceitável hoje pelo volume baixo, mas com sincronização diária o volume cresce em ordem de grandeza. O plano inclui os índices.

### 1.3 O que já existe de extrato e conciliação

A importação de arquivo já é idempotente e roda no servidor (`src/app/api/conciliacao/importar/route.ts:23`):

```
function chaveLinha(contaId, l): string {
  const fitid = typeof l.fitid === 'string' ? l.fitid.trim() : '';
  if (fitid) return `${contaId}|fitid:${fitid}`;
  // fallback: data + valor + descrição
}
```

O cabeçalho do arquivo declara a garantia: *"Idempotente: linha já existente na conta (FITID, ou data+valor+descrição)"*.

**Esta é a estratégia de dedup que o Modo B deve reusar,** e não uma nova. O identificador do banco entra no lugar do FITID.

O matcher atual é de regra única, tolerância fixa de um centavo, sem score (`src/app/financeiro-ag/conciliacao/page.tsx:211`):

```
function findMatches(line: ExtratoLinha) {
  const tolerance = 0.01;
  ...
  Math.abs(cr.valor_final - absVal) <= tolerance && cr.status !== 'CANCELADO' ...
}
```

Ele não olha data, não pontua, não trata parcial nem agrupado. É o ponto de evolução do motor de conciliação.

### 1.4 Dinheiro e datas

Há biblioteca própria, criada na auditoria de 2026-09-01: `src/lib/money.ts`. Dinheiro é `number` em reais, arredondado a duas casas por `round2`, somado por `soma` e `somaPor` (que arredondam o acumulado a cada passo). Datas são strings civis `YYYY-MM-DD` manipuladas por `dataLocal`, `addDias`, `addMeses`, `mesDe`, `estaVencido`, justamente porque `new Date('YYYY-MM-DD')` é interpretado como UTC e retrocede um dia no fuso de Brasília.

**Regra para o plano.** Todo valor vindo de banco passa por `round2` antes de persistir. Toda data vinda de banco é normalizada para `YYYY-MM-DD` antes de comparar. Nenhum `new Date` sobre string de data.

### 1.5 Upload de arquivo

Existe `src/app/api/upload/route.ts`, que grava em disco: `/app/data/uploads` em produção, `public/uploads` em desenvolvimento. **Não serve para certificado**: é diretório servido publicamente em dev e sem cifra em ambos.

### 1.6 Auditoria

`audit_log` existe (`src/lib/db.ts:204`) com colunas `usuario_id`, `acao`, `modulo`, `entidade`, `entidade_id`, `data JSONB`. É exposta pelo CRUD genérico em `src/app/api/audit-log/route.ts:2`. **Não há função helper de escrita**; cada chamador monta o registro. O plano usa a tabela como está e define os eventos.

### 1.7 Agendamento

Não existe. Nenhum `node-cron`, nenhum worker, nenhum `vercel.json` com cron. A aplicação roda como container único no Coolify. Qualquer periodicidade precisa ser criada.

---

## 2. Verificação externa por banco

Separando o que a documentação confirma do que precisa ser validado com uma conta real.

### 2.1 Banco Inter Empresas

| Item | Situação | Valor |
|---|---|---|
| Host de API e de token | **Confirmado** | `https://cdpj.partners.bancointer.com.br` |
| Endpoint de token | **Confirmado** | `POST /oauth/v2/token`, client credentials |
| Endpoint de extrato | **Confirmado** | `GET /banking/v2/extrato` |
| Escopo de leitura | **Confirmado** | `extrato.read` |
| mTLS | **Confirmado** | exige certificado e chave privada em toda chamada |
| Janela máxima por consulta | **Confirmado** | 90 dias entre datas |
| Rate limit | **Confirmado** | 10 chamadas por minuto no escopo de extrato |
| Validade do certificado | **Confirmado** | 12 meses |
| Custo | **Confirmado** | integração gratuita, credencial gerada pelo próprio correntista |
| Endpoint de saldo | **Suposição** | provável `GET /banking/v2/saldo`, a confirmar em conta real |
| Extrato enriquecido e paginação | **Suposição** | há indício de endpoint com paginação, a confirmar |

Onboarding do correntista, **confirmado** em documentação de integrador:

1. Internet Banking PJ, menu `Soluções para sua empresa > Nova integração`
2. Nomear a integração e descrever com o CNPJ
3. Selecionar a conta corrente
4. Marcar **somente** `API Banking` com a permissão `Consultar extrato e saldo`
5. `Criar integração`, confirmar por SMS de 6 dígitos
6. Preencher formulário sobre a empresa
7. Em `Soluções para empresa > Minhas integrações`, `Ações > Detalhar`, baixar o certificado `.crt` e a chave `.key`, e copiar `ClientId` e `ClientSecret`

Ponto sensível confirmado: os arquivos vêm num ZIP e precisam ser enviados **individualmente**, não o ZIP.

### 2.2 Demais bancos

Baseado em levantamento comparativo de terceiro, **não em documentação oficial**. Tudo aqui é suposição a validar.

| Banco | Extrato PJ pelo próprio correntista | Exigência | Custo | Dificuldade |
|---|---|---|---|---|
| Inter | Sim, self service | certificado gerado pelo próprio banco, sem ICP Brasil | gratuito | baixa |
| Sicoob | Sim | certificado ICP Brasil emitido para o CNPJ | a validar | média |
| Banco do Brasil | Sim, portal self service com aprovação por CNPJ | a validar | a validar | média |
| Bradesco | Sim, via Open Banking | certificado A1 ICP Brasil | a validar | média |
| Itaú | Sim | onboarding pelo gerente comercial | a validar | alta |
| Santander | Sim | certificado A1 | a validar | alta |
| Caixa | Legado SOAP XML, sandbox limitado | a validar | a validar | alta |
| Nubank PJ | Não há API pública | somente agregador | n/a | inviável no Modo B |
| Safra | Documentação não pública | gerente comercial | a validar | alta |

**Leitura para o produto.** Só o Inter tem onboarding que uma agência de viagens consegue concluir sozinha, sem gerente e sem comprar certificado. É por ele que se começa, e é o único que a Fase 2 promete.

---

## 3. Decisões de arquitetura

### 3.1 Coletor roda no servidor, dentro da própria aplicação

**Decisão.** A coleta roda em Route Handler do App Router, disparada por chamada externa autenticada, sem processo separado.

**Alternativa descartada:** subir BullMQ com Redis. Motivo: não existe Redis no projeto nem no Coolify deste app, e a carga é de uma execução por conta por dia. Introduzir fila, worker e broker para isso é infraestrutura nova a manter, com custo fixo mensal, para resolver um problema que uma chamada agendada resolve.

**Alternativa descartada:** `setInterval` no processo do Next. Motivo: o container reinicia a cada deploy, o timer morre em silêncio e ninguém percebe até faltar extrato.

**Como o agendamento acontece.** Um endpoint `POST /api/integracoes/bancarias/sincronizar` protegido por segredo de serviço, chamado uma vez por hora pelo agendador do Coolify (recurso Scheduled Task, que já existe na plataforma e não custa nada). O endpoint decide quais contas estão vencidas de sincronização e processa. Se o Coolify não expuser agendador nesta versão, o plano B é um cron externo gratuito chamando a mesma URL. A decisão de qual usar fica para o Bruno, item 12.

### 3.2 Sincronização é serial por conta e idempotente por janela

**Decisão.** Cada execução de conta processa uma janela de datas com sobreposição de 3 dias sobre a última sincronização bem sucedida, e a idempotência vem da chave de linha, não do controle de janela.

**Motivo.** Banco reclassifica lançamento de pendente para efetivado e às vezes muda a descrição. Reprocessar os últimos 3 dias corrige isso sem duplicar, porque a chave de dedup absorve.

### 3.3 Nome de banco não sai do adapter

**Decisão.** O domínio conhece `provedor: string` como opaco. `contas_bancarias` guarda o provedor, mas nenhuma regra de negócio, router ou componente faz `if (provedor === 'inter')`. Toda diferença vive dentro do adapter.

### 3.4 Cifra de segredo: envelope com chave mestra em variável de ambiente

**Decisão.** Cifra simétrica AES 256 GCM. A chave mestra vive em variável de ambiente do container (`INTEGRACOES_MASTER_KEY`), nunca no banco. Cada segredo é cifrado com IV próprio e guardado como `{v, iv, tag, ct}` em base64.

**Alternativa descartada:** guardar em claro no JSONB, como o projeto faz hoje em `config_apis`. Motivo: chave privada de conta bancária tem consequência diferente de chave de API de busca de voos. Um dump de banco vira acesso ao extrato de todas as agências.

**Alternativa descartada:** KMS gerenciado. Motivo: custo mensal e dependência de nuvem que o projeto não tem hoje. Fica registrado como evolução se o produto crescer.

**Consequência operacional que precisa estar clara:** se `INTEGRACOES_MASTER_KEY` for perdida, todas as conexões bancárias precisam ser refeitas pelas agências. A variável precisa estar no backup de configuração do Coolify.

### 3.5 Modo A entra no mesmo contrato sem gambiarra

O contrato tem duas capacidades declaradas por adapter: `coletaAutomatica` e `importaArquivo`. O adapter de OFX declara `coletaAutomatica: false` e implementa apenas `importar(conteudo)`. O orquestrador nunca chama `sincronizar()` em adapter que não declara a capacidade. Não há condicional por fornecedor, há checagem de capacidade.

---

## 4. Contrato do adapter

Apenas tipos e assinaturas. Nenhuma implementação.

```typescript
/** Valor sempre em reais, positivo para crédito e negativo para débito. */
export type Centavos = number;

export type ProvedorId = string;   // opaco para o domínio

export interface TransacaoNormalizada {
  /** Identificador estável do banco quando existe. Null aciona fingerprint. */
  idExterno: string | null;
  data: string;                    // 'YYYY-MM-DD', data civil
  valor: number;                   // já em reais, round2 aplicado
  tipo: 'CREDITO' | 'DEBITO';
  descricao: string;
  /** Saldo após o lançamento, quando o banco informa. */
  saldoApos: number | null;
  /** Lançamento ainda não efetivado. Reprocessável. */
  pendente: boolean;
  /** Categoria bruta do banco, sem tradução. Só para diagnóstico. */
  categoriaOrigem: string | null;
}

export interface SaldoNormalizado {
  disponivel: number;
  bloqueado: number | null;
  limite: number | null;
  apuradoEm: string;               // 'YYYY-MM-DD'
}

export interface JanelaColeta {
  de: string;                      // 'YYYY-MM-DD'
  ate: string;                     // 'YYYY-MM-DD'
}

export interface ResultadoColeta {
  transacoes: TransacaoNormalizada[];
  saldo: SaldoNormalizado | null;
  /** Quando o banco pagina, o adapter já entrega tudo e informa quantas páginas leu. */
  paginasLidas: number;
  /** Janela efetivamente coberta, que pode ser menor que a pedida por limite do banco. */
  janelaCoberta: JanelaColeta;
}

/** Credencial já decifrada. Nunca é serializada, logada nem devolvida por API. */
export interface CredencialDecifrada {
  clientId: string;
  clientSecret: string;
  certificadoPem: string | null;
  chavePrivadaPem: string | null;
  extras: Record<string, string>;
}

export type MotivoFalha =
  | 'CREDENCIAL_INVALIDA'
  | 'CERTIFICADO_EXPIRADO'
  | 'ESCOPO_INSUFICIENTE'
  | 'RATE_LIMIT'
  | 'JANELA_INVALIDA'
  | 'INDISPONIVEL'
  | 'DESCONHECIDO';

export class FalhaColeta extends Error {
  readonly motivo: MotivoFalha;
  /** Mensagem exibível ao usuário, já sem qualquer dado sensível. */
  readonly mensagemUsuario: string;
  /** Sugestão de espera antes de tentar de novo, em segundos. */
  readonly aguardarSegundos: number | null;
}

export interface Capacidades {
  coletaAutomatica: boolean;
  importaArquivo: boolean;
  informaSaldo: boolean;
  informaIdExterno: boolean;
  janelaMaximaDias: number | null;
  chamadasPorMinuto: number | null;
}

export interface CampoCredencial {
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'arquivo_pem';
  obrigatorio: boolean;
  ajuda: string;
}

export interface AdapterBancario {
  readonly id: ProvedorId;
  readonly capacidades: Capacidades;

  /** Campos que a tela de onboarding renderiza. Sem UI por fornecedor. */
  camposCredencial(): CampoCredencial[];

  /** Chamada de teste imediata no cadastro. Erro traz mensagemUsuario acionável. */
  validarCredencial(cred: CredencialDecifrada): Promise<{ ok: true; contaDetectada: string | null }>;

  /** Só quando capacidades.coletaAutomatica é true. */
  coletar(cred: CredencialDecifrada, janela: JanelaColeta): Promise<ResultadoColeta>;

  /** Só quando capacidades.importaArquivo é true. Modo A entra por aqui. */
  importar(conteudo: string, nomeArquivo: string): Promise<ResultadoColeta>;

  /** Data de expiração do material criptográfico, quando aplicável. */
  expiraEm(cred: CredencialDecifrada): Promise<string | null>;
}
```

---

## 5. Modelo de dados

Segue o padrão do repositório: colunas indexadas mais `data JSONB`. SQL proposto para revisão humana, conforme a regra do projeto de nunca aplicar migração sem revisão.

```sql
-- Conexão bancária de um tenant. Uma linha por conta conectada.
CREATE TABLE IF NOT EXISTS conexoes_bancarias (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  conta_bancaria_id TEXT NOT NULL DEFAULT '',
  provedor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma conta bancária tem no máximo uma conexão ativa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conexoes_conta
  ON conexoes_bancarias(tenant_id, conta_bancaria_id);

-- Varredura do agendador: quem está vencido de sincronizar.
CREATE INDEX IF NOT EXISTS idx_conexoes_tenant_status
  ON conexoes_bancarias(tenant_id, status);

-- Segredo cifrado, separado da conexão para poder ter permissão distinta
-- e para que um SELECT de diagnóstico na conexão nunca traga material sensível.
CREATE TABLE IF NOT EXISTS conexoes_bancarias_segredo (
  conexao_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  -- envelope AES-256-GCM: {v, iv, tag, ct}, tudo base64. Nunca em claro.
  envelope JSONB NOT NULL,
  expira_em DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segredo_expira
  ON conexoes_bancarias_segredo(tenant_id, expira_em);

-- Histórico de execuções. Diagnóstico e base do aviso de conexão quebrada.
CREATE TABLE IF NOT EXISTS sincronizacoes_bancarias (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  conexao_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'EXECUTANDO',
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sinc_conexao
  ON sincronizacoes_bancarias(tenant_id, conexao_id, created_at DESC);

-- Índices que faltam hoje e passam a doer com sincronização diária.
CREATE INDEX IF NOT EXISTS idx_extrato_tenant_conta
  ON extrato_bancario(tenant_id, conta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_extrato_tenant_status
  ON extrato_bancario(tenant_id, status_conciliacao);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_status
  ON contas_receber(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cp_tenant_status
  ON contas_pagar(tenant_id, status);
```

Campos dentro de `conexoes_bancarias.data`:

| Campo | Uso |
|---|---|
| `apelido` | nome que a agência deu à conexão |
| `ultimaSincronizacaoEm` | data hora ISO da última execução bem sucedida |
| `ultimaJanela` | `{de, ate}` coberto na última execução |
| `proximaSincronizacaoEm` | usado pelo agendador para decidir a fila |
| `falhasConsecutivas` | zera a cada sucesso, dispara alerta a partir de 3 |
| `ultimoErro` | `{motivo, mensagemUsuario, em}`, nunca o erro cru do banco |
| `contaDetectada` | agência e conta que o banco devolveu na validação |

Campos acrescentados em `extrato_bancario.data`, sem quebrar o que existe:

| Campo | Uso |
|---|---|
| `id_externo` | identificador do banco, quando houver |
| `origem` | `ARQUIVO` ou `SINCRONIZACAO` |
| `conexao_id` | qual conexão trouxe a linha |
| `pendente` | lançamento não efetivado, reprocessável |

`arquivo_origem` continua existindo e passa a receber o identificador da sincronização quando `origem = SINCRONIZACAO`, para a tela atual não quebrar.

---

## 6. Estratégia de deduplicação

Reaproveita `chaveLinha` de `src/app/api/conciliacao/importar/route.ts:23`, estendida:

1. Se o banco devolve `idExterno`, a chave é `${contaId}|ext:${idExterno}`.
2. Se não devolve, a chave é `${contaId}|fp:${data}|${valorEmCentavos}|${descricaoNormalizada}`, com a descrição em caixa baixa, sem acento e sem espaço duplicado.
3. Linha já existente com a mesma chave **não é inserida**.

**Transição de pendente para efetivado.** Quando a chave já existe e a linha nova chega com `pendente: false` enquanto a gravada está `pendente: true`, a linha é **atualizada**, não duplicada: atualiza `pendente`, `descricao` e `saldoApos`, preserva `id`, `status_conciliacao` e qualquer vínculo de conciliação já feito. É o único caso de atualização de linha de extrato.

**Descrição que muda entre sincronizações** e banco sem `idExterno`: a mudança de descrição gera fingerprint diferente e duplicaria. Mitigação: quando não há `idExterno`, a comparação de fingerprint usa apenas `data` e `valor` para localizar candidata, e só então compara descrição por similaridade. Se houver exatamente uma candidata no mesmo dia com o mesmo valor e sem vínculo, trata como a mesma linha e atualiza a descrição.

---

## 7. Agendamento

| Item | Decisão |
|---|---|
| Gatilho | `POST /api/integracoes/bancarias/sincronizar`, autenticado por `Authorization: Bearer <INTEGRACOES_CRON_SECRET>` |
| Frequência do gatilho | de hora em hora |
| Frequência por conta | uma vez por dia por padrão, configurável por tenant entre 1 e 4 vezes |
| Seleção | contas com `proximaSincronizacaoEm <= agora` e `status = ATIVA`, no máximo 20 por execução |
| Janela | de `ultimaSincronizacaoEm - 3 dias` até hoje. Primeira carga: 90 dias, respeitando o teto do Inter |
| Identificador de execução | `sinc:${conexaoId}:${dataHoraTruncadaEmHora}`, gravado em `sincronizacoes_bancarias.id` para impedir execução dupla na mesma hora |
| Serialização | lock consultivo `pg_advisory_xact_lock(hashtext(conexaoId))`, mesmo padrão já usado no CRM para automação entre funis |
| Backoff | falha 1 adia 1 hora, falha 2 adia 4 horas, falha 3 em diante adia 24 horas e marca a conexão como `ATENCAO` |
| Rate limit | o adapter do Inter espaça chamadas para no máximo 10 por minuto, contando por credencial e não global |
| Credencial expirada | conexão vai para `EXPIRADA`, sincronização para, agência é avisada, importação por arquivo continua disponível |

---

## 8. Motor de conciliação

Cascata de regras. A primeira que casar com score suficiente vence. Nada é conciliado automaticamente sem confirmação humana na primeira versão.

| Regra | Condição | Score |
|---|---|---|
| R1 exata | valor idêntico e data do lançamento igual à do vencimento | 100 |
| R2 valor e janela | valor idêntico e vencimento dentro da tolerância de dias | 85 |
| R3 valor, janela e nome | R2 mais nome do cliente ou fornecedor contido na descrição | 95 |
| R4 aproximada | diferença de valor até a tolerância configurada e dentro da janela | 70 |
| R5 agrupada | soma de 2 a 5 títulos em aberto do mesmo cliente bate com o lançamento | 65 |
| R6 parcial | lançamento menor que o título, mesmo cliente, dentro da janela | 60 |
| R7 transferência | existe transferência efetivada com mesmo valor e data entre contas do tenant | 90 |

Parâmetros por tenant: tolerância de dias, padrão 3. Tolerância de valor, padrão zero. Score mínimo para sugerir, padrão 60.

**Ambiguidade.** Duas ou mais candidatas com score dentro de 5 pontos: nenhuma é sugerida, a linha vai para a fila de pendências com as candidatas listadas para escolha manual. Sugerir a errada custa mais caro que não sugerir.

**Reversão.** Desfazer conciliação devolve a linha para `PENDENTE`, limpa o vínculo e reverte a baixa do título pelo caminho que move o saldo, nunca por escrita direta, conforme a regra estabelecida na auditoria de 2026-09-01.

**Ruído que não é receita nem despesa.** Tarifa, estorno, transferência entre contas próprias e aplicação automática recebem classificação `NAO_OPERACIONAL` e ficam fora do fluxo de caixa operacional. A detecção é por regra de descrição configurável por tenant, com lista inicial semeada. Falso positivo aqui é barato de corrigir e caro de ignorar.

---

## 9. Onboarding, tela a tela, começando pelo Inter

Tela única, quatro passos, com validação antes de salvar.

**Passo 1, escolher a conta.** Lista as contas bancárias já cadastradas em `contas_bancarias` sem conexão ativa. Se não houver, oferece criar.

**Passo 2, instruções do banco.** Texto fiel ao caminho real do Inter, com a advertência que mais gera suporte:

> No Internet Banking PJ do Inter, vá em `Soluções para sua empresa > Nova integração`. Dê um nome, informe seu CNPJ na descrição e selecione a conta. Marque **somente** `API Banking` com a permissão `Consultar extrato e saldo`. Não marque nenhuma outra permissão. Confirme por SMS e preencha o formulário da empresa. Depois vá em `Minhas integrações > Ações > Detalhar` e baixe o certificado e a chave. **Descompacte o ZIP e envie os dois arquivos separados, não o ZIP.**

**Passo 3, colar as credenciais.** Campos renderizados a partir de `camposCredencial()`, sem nada específico de banco no componente: ClientId, ClientSecret, arquivo `.crt`, arquivo `.key`. Os dois arquivos são lidos no navegador e enviados no corpo da requisição por HTTPS, nunca pela rota de upload pública.

**Passo 4, validar.** O sistema chama `validarCredencial()` na hora. Mensagens acionáveis, sem jargão:

| Situação | Mensagem |
|---|---|
| Sucesso | Conexão validada. Conta 0001 / 12345 6 reconhecida pelo Inter. |
| Escopo faltando | A integração foi criada sem a permissão de consultar extrato e saldo. Refaça no Inter marcando essa permissão. |
| Certificado e chave trocados | O conteúdo do certificado e da chave parecem invertidos. Confira qual arquivo foi enviado em cada campo. |
| ZIP enviado | Envie os arquivos `.crt` e `.key` separados, não o arquivo compactado. |
| Credencial inválida | O Inter recusou o ClientId ou o ClientSecret. Copie os dois novamente na tela de detalhes da integração. |
| Certificado vencido | Este certificado expirou em DD/MM/AAAA. Gere uma nova integração no Inter. |

**Estado da conexão na tela de contas bancárias:** `Conectada, sincronizada às HH:MM`, `Atenção, N falhas seguidas`, `Expirada, reconecte`, `Sem conexão automática`.

---

## 10. Renovação de certificado

O certificado do Inter vale 12 meses. `expiraEm()` grava a data em `conexoes_bancarias_segredo.expira_em` no cadastro.

| Momento | Ação |
|---|---|
| 30 dias antes | aviso no sino e na tela de contas bancárias |
| 7 dias antes | aviso persistente, não dispensável |
| No vencimento | conexão vai para `EXPIRADA`, sincronização para, banner com o caminho de renovação |

Renovar substitui apenas o envelope de segredo. `conexao_id` não muda, o histórico de extrato e de conciliação é preservado inteiro.

---

## 11. Fases de entrega

Cada fase entrega valor sozinha.

### Fase 0, fundação de segurança
Cifra AES 256 GCM, tabelas de conexão e segredo, índices que faltam.
**Valor:** nenhum visível ainda. É a fase que não pode ser pulada.
**Aceite:** segredo gravado é ilegível em `SELECT * FROM conexoes_bancarias_segredo`; decifra e cifra têm teste; `INTEGRACOES_MASTER_KEY` documentada no Coolify.

### Fase 1, contrato e adapter de arquivo
Interface do adapter, adapter OFX e CSV embrulhando o parser que já existe, sem mudar comportamento.
**Valor:** a importação atual passa a viver no contrato novo, e nada regride.
**Aceite:** importar o mesmo arquivo duas vezes não duplica linha; o teste que hoje cobre a rota continua verde.

### Fase 2, adapter do Inter e conexão manual
Onboarding, validação imediata, botão `Sincronizar agora`. Sem agendamento.
**Valor:** a agência conecta e traz o extrato com um clique, em vez de baixar arquivo.
**Aceite:** conexão validada com conta real; extrato de 90 dias entra sem duplicar; credencial errada devolve a mensagem certa; nenhum segredo aparece em log ou resposta.

### Fase 3, agendamento
Endpoint de sincronização, seleção por vencimento, backoff, histórico de execuções.
**Valor:** o extrato entra sozinho, todo dia.
**Aceite:** duas chamadas na mesma hora processam uma vez; falha três vezes marca `ATENCAO`; janela com sobreposição não duplica.

### Fase 4, motor de conciliação com score
Cascata R1 a R7, tolerância por tenant, ambiguidade, parcial e agrupada.
**Valor:** a fila de pendências encolhe.
**Aceite:** cada regra tem teste com número; ambiguidade não sugere; reversão devolve o saldo pelo caminho que move o caixa.

### Fase 5, saúde da conexão
Aviso de vencimento, estado na UI, fallback para arquivo, alertas de falha.
**Valor:** a agência descobre o problema antes de sentir falta do extrato.
**Aceite:** aviso dispara em 30 e em 7 dias; conexão expirada não impede importar arquivo.

**Fora de escopo nesta rodada:** cartão de crédito, que tem fatura e não extrato, com ciclo de fechamento próprio e conciliação de natureza diferente. Entra depois, como módulo próprio. Agregador de Open Finance, que só ganha sentido se a cobertura do Modo B se mostrar insuficiente na prática.

---

## 12. Cobertura real

Estimativa a validar com a base de agências, que ainda não foi consultada.

| Modo | Cobertura estimada | Observação |
|---|---|---|
| Modo A, arquivo | 100% | funciona em qualquer banco, custa trabalho manual |
| Modo B, Inter | a medir | depende de quantas agências têm conta no Inter |
| Modo B, demais bancos | menor | onboarding com gerente ou certificado ICP Brasil derruba a adesão |

**O que fazer com o resto.** Continua no Modo A, com a fila de pendências e a conciliação assistida funcionando igual. O ganho da automação é a coleta, não a conciliação, e a conciliação atende os dois modos.

**Pergunta que precede o investimento em outros bancos:** quantas das agências ativas têm conta em qual banco. Sem esse número, escolher o segundo adapter é chute.

---

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| mTLS por tenant em Node sem vazar entre requisições | um `https.Agent` por conexão, criado sob demanda e mantido em cache com TTL curto, chaveado por `conexaoId`. Nunca um agente global mutável. O cache guarda o agente, nunca o PEM em claro fora dele |
| Chave privada em memória | decifrada apenas dentro do escopo da chamada, nunca anexada a objeto de log, erro ou payload. `FalhaColeta` carrega só `mensagemUsuario` |
| Rate limit do Inter, 10 por minuto | espaçamento por credencial no adapter, e no máximo 20 contas por execução do agendador |
| Janela de 90 dias na carga inicial | carga inicial em blocos de 90 dias, do mais recente para o mais antigo, com limite de 1 ano configurável |
| Descrição instável entre sincronizações | fingerprint por data e valor, com descrição usada só para desempate |
| Tarifa, estorno, transferência e aplicação poluindo o caixa | classificação `NAO_OPERACIONAL` por regra de descrição, fora do fluxo operacional |
| Agência troca de banco ou revoga credencial | desconectar apaga o segredo e mantém o extrato já importado; conexão revogada cai em `EXPIRADA` na primeira falha de autenticação |
| Perda da chave mestra | documentar em runbook; incluir a variável no backup de configuração; sem ela, reconexão manual de todas as agências |
| LGPD | extrato é dado financeiro do titular tenant. Base legal: execução de contrato. Finalidade: conciliação. Retenção: enquanto o contrato durar mais o prazo fiscal de 5 anos. Desconexão apaga credencial imediatamente e preserva o extrato já conciliado, que é registro contábil. Cancelamento do plano segue a política de retenção que o produto já tiver, que **não localizei no repositório** e precisa ser definida |

---

## 14. Perguntas abertas para o Bruno

1. **Agendador.** O Coolify deste servidor expõe Scheduled Tasks para esta aplicação? Se não, aceita um cron externo gratuito chamando a URL, ou prefere que a aplicação suba um processo próprio?
2. **Distribuição por banco.** Quantas agências ativas usam Inter, Sicoob, BB, Bradesco, Itaú? Sem isso, o segundo adapter é escolhido no escuro.
3. **Conta real do Inter para homologar.** A Fase 2 não fecha sem uma conta PJ real, porque o sandbox não reproduz o comportamento de extrato com movimento. Existe uma conta disponível para teste?
4. **Conciliação automática.** O plano exige confirmação humana em toda conciliação. Aceita que score 100 concilie sozinho depois que a Fase 4 estabilizar, ou prefere confirmação sempre?
5. **Retenção de dados.** Qual a política ao cancelar o plano? Não há nada no repositório sobre isso e a resposta afeta o texto de LGPD.
6. **Cartão de crédito.** Confirma ficar fora desta rodada?

---

## 15. Checklist do próprio plano

| Exigência | Situação |
|---|---|
| Toda afirmação sobre o código cita arquivo e trecho | sim |
| Toda afirmação sobre API de banco marcada como confirmada ou suposição | sim, seção 2 |
| Contrato cobre os três modos sem condicional por fornecedor fora dos adapters | sim, por capacidades declaradas |
| Resposta explícita para dedup, pendente para efetivado e reprocessamento | sim, seção 6 |
| Decisão explícita sobre onde e como a chave privada é cifrada | sim, seção 3.4 e tabela de segredo |
| Fluxo de renovação de certificado com aviso antecipado | sim, seção 10 |
| Fallback para arquivo quando a conexão falha | sim, Fase 5 e tabela de estados |
| Cada fase entrega valor sozinha e tem aceite verificável | sim, seção 11 |
| O plano diz quanto da base fica sem automação | parcialmente: a estimativa depende da distribuição por banco, que virou pergunta aberta 2 |
| Nenhuma etapa exige agregador pago | sim |
