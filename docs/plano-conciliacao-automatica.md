# Conciliação bancária automática no Entur OS FIN

Documento de planejamento. Nenhuma linha de código de produção foi escrita.
Alvo: **Entur OS FIN**, aplicação `grupos-os-app` (Coolify interno), repositório `financeiro-os`.

Base de evidência desta rodada: 30 bancos pesquisados, cada um com um pesquisador e um verificador cético independente, 279 afirmações com fonte e 117 suposições declaradas, mais três varreduras do repositório com referência de arquivo e linha.

---

## 1. O que mudou desde o plano anterior

O documento `plano-extrato-automatico.md` assumia que o Inter seria o primeiro e praticamente único adapter viável. A pesquisa derrubou parte disso e acrescentou o que faltava.

| Ponto | Plano anterior | Agora |
|---|---|---|
| Bancos com onboarding sem gerente | só Inter | 10 bancos com acesso por autoatendimento |
| Melhor candidato técnico | Inter | Inter continua o melhor gratuito, mas **não** entrega identificador por lançamento; Asaas, Mercado Pago, Cora, Sicredi, Stone e BS2 entregam |
| Gratuidade | assumida para o Inter | confirmada só para sandbox em vários casos. BTG exige plano de R$ 200,00/mês, Cora exige Cora Pro de R$ 44,90/mês, Original R$ 250,00/mês. Santander confirma gratuidade apenas em sandbox e remete produção ao gerente |
| Open Finance direto | tratado como evolução | **descartado**. Software não regulado não pode ser receptor. Capital mínimo de R$ 1 milhão para virar ITP |
| Prioridade de integração | por tamanho do banco | invertida: **adquirente antes de banco pequeno** |
| Conciliação atual | tratada como base a evoluir | tem 10 defeitos reais mapeados que precisam ser corrigidos antes, não depois |

### A inversão que muda o produto

O levantamento de mercado apurou dado primário da planilha do Cadastur, 2T2026: **57.723 agências de viagens** no Brasil, 89,6% microempresa e 7,1% EPP, ou seja 96,7% micro ou pequena, 57,2% sem nenhum empregado. A Braztoa 2026 registra cartão de crédito em mais de 65% das transações do setor, parcelado de 5 a 10 vezes.

Consequência direta: **nenhum extrato bancário mostra agenda de recebíveis**. A agência que vendeu R$ 40 mil parcelados em 10 vezes vê no extrato apenas a parcela líquida que caiu hoje, já descontada a taxa, sem vínculo com a venda. Integrar mais um banco pequeno não resolve isso. Integrar Cielo, Rede, Getnet ou Stone resolve.

Segundo dado do Sebrae/IPESPE: 61% dos pequenos negócios pagam despesa da empresa pela conta pessoal. O modelo de dados precisa aceitar a conta pessoa física do sócio marcada como uso misto, senão a conciliação vai divergir por desenho.

---

## 2. Estado real do código

Três varreduras independentes do repositório. Tudo abaixo tem arquivo e linha no relatório completo.

### 2.1 O que já existe

| Peça | Onde | Situação |
|---|---|---|
| Tabela de extrato | `src/lib/db.ts:151` | existe, só com índice de tenant |
| Tipo da linha | `src/lib/crm-types.ts:515` | existe, com campos de conciliação |
| Leitor de OFX | `src/app/financeiro-ag/conciliacao/page.tsx:74` | existe, única origem de FITID |
| Leitor de CSV | mesma tela, `:37` | existe, nunca gera FITID |
| Importação idempotente | `src/app/api/conciliacao/importar/route.ts:23` | dedup por `conta|fitid` ou `conta|data|valor|descrição` |
| Caixa atômico | `src/lib/caixa-atomico.ts` | guarda otimista por `xmin`, saldo por um único UPDATE |
| Biblioteca de dinheiro | `src/lib/money.ts` | `round2`, `soma`, datas civis no fuso de São Paulo |
| Isolamento por tenant | `src/lib/crud-api.ts:48` | `tenant_id` no WHERE de toda escrita |

### 2.2 Os dez defeitos que precisam morrer antes

Não é possível colocar coleta automática em cima disso. Um arquivo importado uma vez por mês esconde estes defeitos; uma sincronização diária os transforma em corrupção de dado.

| # | Defeito | Onde | Consequência |
|---|---|---|---|
| D1 | Dedup lê **fora** da transação e não há índice único | `importar/route.ts:53` antes do `BEGIN` em `:66` | duas sincronizações simultâneas duplicam o extrato inteiro |
| D2 | Sem FITID, dois PIX de mesmo valor no mesmo dia colapsam em um | `importar/route.ts:23` | a segunda transação real **some**, contada como duplicada |
| D3 | Conciliar força `RECEBIDO` e **substitui** o acumulado | `conciliacao/page.tsx:251` | baixa parcial vira quitação; destrói o valor já recebido |
| D4 | Baixa e marcação do extrato são duas requisições sem transação | `conciliacao/page.tsx:240` | falha no meio deixa título baixado e extrato pendente, ou o inverso |
| D5 | `PUT` do CRUD devolve 200 sem checar `rowCount` | `crud-api.ts:106` | a tela diz "conciliado" mesmo quando nada foi gravado |
| D6 | Desfazer conciliação **não existe** | `conciliacao/page.tsx:529` | `CONCILIADO` é terminal. Erro do operador é permanente |
| D7 | Campo `saldo` da linha reinicia em zero por arquivo e soma ignoradas | `importar/route.ts:69` | número exibido sem significado |
| D8 | Guarda de dupla baixa só no cliente | `conciliacao/page.tsx:200` | duas abas conciliam duas linhas no mesmo título |
| D9 | `GET /api/extrato-bancario` carrega o tenant inteiro sem filtro nem LIMIT | `crud-api.ts:11` | com sincronização diária, a tela para de abrir |
| D10 | `audit_log` existe e **nada escreve nela** | `db.ts:204` | não há rastro de quem conciliou o quê |

Cobertura de teste de importação e conciliação hoje: **zero**.

Há ainda três saldos concorrentes que nunca são confrontados: o `saldo_atual` persistido, o `calcularSaldoBancario` derivado (que ignora transferências, `saldo-bancario.ts:36`) e o `saldo` da linha de extrato. Conciliação automática só faz sentido com um número de referência confiável, então isso precisa ser resolvido.

---

## 3. Cobertura bancária

Os 30 bancos, ordenados por viabilidade do Modo B, que é a coleta direta com credencial que a própria agência gera. Coluna de confiança reflete o veredito do verificador cético, não a primeira pesquisa.

| Banco | Viabilidade | Quem libera | Certificado | Custo | Id por lançamento | Confiança |
|---|---|---|---|---|---|---|
| Asaas | alta | autoatendimento | nenhum | não confirmado | sim | confirmado |
| BTG Pactual | alta | autoatendimento | nenhum | R$ 200,00/mês | sim | confirmado |
| Banco Inter | alta | autoatendimento | do banco | gratuito | não | provável |
| Mercado Pago | alta | autoatendimento | nenhum | gratuito | sim | provável |
| Sicoob | alta | autoatendimento | ICP A1 (pago) | não confirmado | não | provável |
| Cora | média | autoatendimento | não resolvido | R$ 44,90/mês | sim | provável |
| Efí Bank | média | autoatendimento | do banco | gratuito | não resolvido | provável |
| PagBank | média | por chamado | nenhum | gratuito | não resolvido | provável |
| Santander | média | autoatendimento | ICP A1 (pago) | só sandbox | não | confirmado |
| Sicredi | média | gerente | do banco | não confirmado | sim | provável |
| BRB | baixa | só Open Finance | não resolvido | não confirmado | não resolvido | provável |
| BS2 | baixa | parceiro homologado | nenhum | não confirmado | sim | provável |
| Banco do Brasil | baixa | gerente | ICP A1 (pago) | não confirmado | não resolvido | suposição |
| Banestes | baixa | gerente | não resolvido | não confirmado | não | confirmado |
| Bmg | baixa | só Open Finance | ICP (pago) | não confirmado | não resolvido | confirmado |
| Bradesco | baixa | autoatendimento | ICP A1 (pago) | não confirmado | não resolvido | provável |
| C6 Bank | baixa | não existe | do banco | gratuito | não resolvido | suposição |
| Cresol | baixa | não existe | não resolvido | não confirmado | não resolvido | provável |
| Itaú | baixa | gerente | do banco | não confirmado | não resolvido | provável |
| Stone | baixa | parceiro homologado | nenhum | não confirmado | sim | confirmado |
| Ailos | inviável | não existe | nenhum | não confirmado | não resolvido | confirmado |
| Banco Original | inviável | não existe | nenhum | R$ 250,00/mês | não resolvido | provável |
| Banco do Nordeste | inviável | só Open Finance | nenhum | não confirmado | não resolvido | provável |
| Banrisul | inviável | só Open Finance | não resolvido | não confirmado | não resolvido | provável |
| Caixa | inviável | gerente | não resolvido | não confirmado | não resolvido | provável |
| Neon | inviável | não existe | não resolvido | não confirmado | não resolvido | provável |
| Nubank PJ | inviável | só Open Finance | nenhum | não confirmado | não resolvido | provável |
| Safra | inviável | não existe | nenhum | não confirmado | não resolvido | provável |
| Unicred | inviável | só Open Finance | nenhum | não confirmado | não resolvido | provável |
| XP Empresas | inviável | só Open Finance | não resolvido | gratuito | sim | suposição |

Resumo: **10 com acesso por autoatendimento**, 5 dependem de gerente, 7 só via Open Finance, 2 exigem ser parceiro homologado, 6 não têm API de extrato para o correntista.

### 3.1 Detalhe técnico dos cinco primeiros

| | Inter | Sicoob | Santander | Mercado Pago | Asaas |
|---|---|---|---|---|---|
| Autenticação | OAuth2 client credentials + mTLS | OAuth2 client credentials + mTLS | OAuth2 client credentials + mTLS (RFC 8705) | OAuth2 Bearer, sem mTLS | chave estática no header `access_token` |
| Certificado | gerado pelo banco, validade 12 meses | ICP-Brasil A1, comprado no mercado | ICP-Brasil A1 | nenhum | nenhum |
| Extrato | `GET /banking/v2/extrato` e `/extrato/completo` | `GET /conta-corrente/v3/extrato/{mes}/{ano}` | `GET /bank_account_information/v1/transactions/{ag.conta}` | relatório em lote, CSV, assíncrono | `GET /v3/financialTransactions` |
| Escopos | `extrato.read` | `openid`, `cco_saldo`, `cco_extrato` | não publicados | `read`, `offline_access` | não se aplica |
| Janela máxima | 90 dias | 31 dias (mês a mês) | não publicada | 60 dias | não publicada |
| Rate limit | 10 por minuto | não publicado | não publicado | não publicado | por endpoint, via header |
| Paginação | só no `/completo`, `pagina` e `tamanhoPagina` | não há | `_limit` e `_nextPage`, documentação inconsistente | não se aplica | `offset` e `limit` |
| Identificador por lançamento | **não** | **não** | **não** | sim | sim |
| Pendente separado | não informado | não informado | **sim**, endpoint `/provisioneds` separado | sim | não informado |
| Sandbox | sim | sim | sim | sim | sim |

Três observações que mudam implementação:

**O Inter não devolve identificador de lançamento.** Confirmado em SDK comunitário: a resposta tem `dataLancamento`, `tipoLancamento`, `tipoOperacao`, `valor`, `titulo`, `descricao` e nada mais. Isso significa que o defeito D2 acima, dois PIX iguais no mesmo dia colapsando, **vai acontecer no Inter**. A estratégia de deduplicação por impressão digital precisa incluir contador de ocorrência, não pode ser só data mais valor mais descrição.

**O Santander separa lançamento efetivado de provisionado em dois endpoints.** Para ter visão completa é preciso somar `/transactions` com `/provisioneds`. Um lançamento migra de um para o outro, o que é exatamente o caso de transição de pendente para efetivado.

**O Mercado Pago não tem consulta REST por lançamento.** É geração de relatório em lote, assíncrona, que devolve CSV. O adapter dele é mais parecido com o de arquivo do que com o de API, e o contrato precisa comportar isso sem gambiarra.

### 3.2 Open Finance direto: descartado

Verificado em fonte normativa. O art. 1º da Resolução Conjunta CMN/BCB nº 1/2020 restringe receptor de dados a instituição autorizada a funcionar pelo Banco Central. O art. 36 permite parceria com entidade não autorizada, mas sempre como contratada de um participante, nunca como receptor direto.

Virar Instituição de Pagamento iniciadora exige capital mínimo de R$ 1 milhão (Resolução BCB nº 80/2021, art. 17, II). É o caminho que Pluggy, Belvo, Klavi e Iniciador percorreram, todos confirmados no diretório oficial como IP com papéis de dados e pagamento ativos.

Se em algum momento o Modo C entrar, a cobertura não é diferencial entre fornecedores: Itaú, Bradesco, Caixa, Nubank, Sicoob e Sicredi são transmissores ativos alcançáveis por qualquer agregador com papel de dados. O que diferencia é preço e suporte. Preço público: Pluggy R$ 2.500,00/mês em dados, Belvo a partir de USD 1.000,00/mês. É custo fixo mensal, não por cliente, o que quebra a premissa de custo variável zero e só fecha com base instalada grande.

Uma exigência regulatória vale para todos e precisa virar requisito de produto: **o consentimento do Open Finance expira em 12 meses** por norma do Banco Central (art. 10, §1º, III), não por política comercial.

---

## 4. Decisões de arquitetura

### 4.1 Corrigir antes de automatizar

**Decisão.** A Fase 0 corrige os dez defeitos da seção 2.2 e cria teste de importação e conciliação, que hoje é zero. Só depois entra coleta automática.

**Alternativa descartada:** construir o Modo B em paralelo e corrigir depois. Motivo: D1 e D2 são defeitos de duplicação e perda de lançamento. Com importação manual mensal eles são raros; com sincronização diária e janela sobreposta eles são certos. Automatizar primeiro significa corromper o extrato mais rápido.

### 4.2 Coletor dentro da aplicação, disparado por agendador externo

**Decisão.** Route Handler protegido por segredo de serviço, chamado de hora em hora pelo agendador do Coolify.

**Alternativa descartada:** BullMQ com Redis. Não existe Redis no projeto nem neste app do Coolify, e a carga é de uma execução por conta por dia. Fila, worker e broker novos, com custo fixo, para um problema que uma chamada agendada resolve.

**Alternativa descartada:** `setInterval` no processo do Next. O container reinicia a cada deploy, o timer morre em silêncio e ninguém percebe até faltar extrato.

### 4.3 Nome de banco não sai do adapter

**Decisão.** O domínio conhece `provedor: string` como opaco. Nenhuma regra de negócio, rota ou componente faz comparação por nome de banco. Toda diferença vive dentro do adapter.

### 4.4 Cifra por envelope, com chave mestra em variável de ambiente

**Decisão.** AES 256 GCM. Chave mestra em `INTEGRACOES_MASTER_KEY`, no ambiente do container, nunca no banco. Cada segredo cifrado com IV próprio, guardado como `{v, iv, tag, ct}` em base64.

**Alternativa descartada:** texto puro, como o projeto faz hoje em `config_apis` (`db.ts:282`, gravado em claro em `apis-config/route.ts:29`). Chave privada de conta bancária tem consequência diferente de chave de API de busca de voos. Um dump do banco viraria acesso ao extrato de todas as agências.

**Alternativa descartada:** KMS gerenciado. Custo mensal e dependência de nuvem que o projeto não tem. Fica registrado como evolução.

Consequência operacional: perder `INTEGRACOES_MASTER_KEY` obriga todas as agências a refazer a conexão. A variável precisa entrar no backup de configuração do Coolify.

**Onde não guardar:** a rota de upload existente (`src/app/api/upload/route.ts`) grava em diretório servido publicamente e está na lista branca do middleware (`src/middleware.ts:45`), acessível sem sessão e sem checagem de tenant. Certificado e chave nunca passam por ela.

### 4.5 Três formas de coleta no mesmo contrato

O adapter declara capacidades em vez de o orquestrador perguntar quem é o fornecedor:

| Capacidade | Quem tem |
|---|---|
| `coletaSincrona` | Inter, Sicoob, Santander, Sicredi, Cora, Asaas, BTG |
| `coletaPorRelatorio` (assíncrono, gera arquivo) | Mercado Pago, Efí (CNAB 240), PagBank (EDI diário) |
| `importaArquivo` | OFX e CSV, o fallback universal |

O orquestrador nunca chama um método que a capacidade não declara. Não há condicional por fornecedor fora dos adapters.

---

## 5. Contrato do adapter

Apenas tipos e assinaturas.

```typescript
export type ProvedorId = string;   // opaco para o domínio

export interface TransacaoNormalizada {
  /** Identificador estável do banco. Null aciona impressão digital. */
  idExterno: string | null;
  data: string;                    // 'YYYY-MM-DD', data civil
  valor: number;                   // reais, round2 aplicado, sinal define o tipo
  tipo: 'CREDITO' | 'DEBITO';
  descricao: string;
  /** Saldo após o lançamento, quando o banco informa. */
  saldoApos: number | null;
  /** Lançamento ainda não efetivado. Reprocessável. */
  pendente: boolean;
  /** Categoria bruta do banco, sem tradução. Só diagnóstico. */
  categoriaOrigem: string | null;
  /** Ordem dentro do dia, quando o banco preserva. Desempata iguais. */
  sequenciaNoDia: number | null;
}

export interface SaldoNormalizado {
  disponivel: number;
  bloqueado: number | null;
  limite: number | null;
  apuradoEm: string;
}

export interface JanelaColeta { de: string; ate: string }

export interface ResultadoColeta {
  transacoes: TransacaoNormalizada[];
  saldo: SaldoNormalizado | null;
  paginasLidas: number;
  /** Janela realmente coberta, que pode ser menor que a pedida. */
  janelaCoberta: JanelaColeta;
  /** True quando o banco separa efetivado de pendente e ambos foram lidos. */
  incluiPendentes: boolean;
}

/** Credencial já decifrada. Nunca serializada, logada nem devolvida por API. */
export interface CredencialDecifrada {
  clientId: string | null;
  clientSecret: string | null;
  apiKey: string | null;
  certificadoPem: string | null;
  chavePrivadaPem: string | null;
  extras: Record<string, string>;
}

export type MotivoFalha =
  | 'CREDENCIAL_INVALIDA' | 'CERTIFICADO_EXPIRADO' | 'ESCOPO_INSUFICIENTE'
  | 'RATE_LIMIT' | 'JANELA_INVALIDA' | 'PLANO_NAO_CONTRATADO'
  | 'RELATORIO_NAO_PRONTO' | 'INDISPONIVEL' | 'DESCONHECIDO';

export class FalhaColeta extends Error {
  readonly motivo: MotivoFalha;
  /** Texto exibível, já sem qualquer dado sensível. */
  readonly mensagemUsuario: string;
  readonly aguardarSegundos: number | null;
}

export interface Capacidades {
  coletaSincrona: boolean;
  coletaPorRelatorio: boolean;
  importaArquivo: boolean;
  informaSaldo: boolean;
  informaIdExterno: boolean;
  separaPendentes: boolean;
  janelaMaximaDias: number | null;
  chamadasPorMinuto: number | null;
  exigeCertificado: 'nenhum' | 'gerado_pelo_banco' | 'icp_brasil';
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

  /** Teste imediato no cadastro. Erro traz mensagemUsuario acionável. */
  validarCredencial(cred: CredencialDecifrada): Promise<{ ok: true; contaDetectada: string | null }>;

  /** Só quando capacidades.coletaSincrona. */
  coletar?(cred: CredencialDecifrada, janela: JanelaColeta): Promise<ResultadoColeta>;

  /** Só quando capacidades.coletaPorRelatorio. Fluxo em dois tempos. */
  solicitarRelatorio?(cred: CredencialDecifrada, janela: JanelaColeta): Promise<{ referencia: string }>;
  buscarRelatorio?(cred: CredencialDecifrada, referencia: string): Promise<ResultadoColeta>;

  /** Só quando capacidades.importaArquivo. */
  importar?(conteudo: string, nomeArquivo: string): Promise<ResultadoColeta>;

  /** Data de expiração do material criptográfico, quando aplicável. */
  expiraEm(cred: CredencialDecifrada): Promise<string | null>;
}
```

---

## 6. Modelo de dados

Segue o padrão do repositório: colunas indexadas mais `data JSONB`. SQL para revisão humana antes de rodar, conforme a regra do projeto.

```sql
-- Conexão bancária de um tenant. Uma por conta conectada.
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_conexoes_conta
  ON conexoes_bancarias(tenant_id, conta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_conexoes_tenant_status
  ON conexoes_bancarias(tenant_id, status);

-- Segredo cifrado, separado da conexão para que um SELECT de
-- diagnóstico na conexão nunca traga material sensível.
CREATE TABLE IF NOT EXISTS conexoes_bancarias_segredo (
  conexao_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  envelope JSONB NOT NULL,   -- AES-256-GCM {v, iv, tag, ct}, tudo base64
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

-- Chave de deduplicação materializada em coluna, para virar índice único.
-- Corrige D1 e D2: sem isso, a dedup continua sendo leitura fora da transação.
ALTER TABLE extrato_bancario
  ADD COLUMN IF NOT EXISTS chave_dedup TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_extrato_dedup
  ON extrato_bancario(tenant_id, chave_dedup)
  WHERE chave_dedup <> '';

-- Índices que faltam e passam a doer com sincronização diária (corrige D9).
CREATE INDEX IF NOT EXISTS idx_extrato_tenant_conta_data
  ON extrato_bancario(tenant_id, conta_bancaria_id, (data->>'data') DESC);
CREATE INDEX IF NOT EXISTS idx_extrato_tenant_status
  ON extrato_bancario(tenant_id, status_conciliacao);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_status
  ON contas_receber(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cp_tenant_status
  ON contas_pagar(tenant_id, status);

-- Impede duas linhas de extrato conciliadas no mesmo título (corrige D8).
CREATE UNIQUE INDEX IF NOT EXISTS uq_extrato_vinculo
  ON extrato_bancario(tenant_id, (data->>'lancamento_vinculado_tipo'), (data->>'lancamento_vinculado_id'))
  WHERE data->>'lancamento_vinculado_id' IS NOT NULL
    AND data->>'lancamento_vinculado_id' <> ''
    AND status_conciliacao = 'CONCILIADO';
```

Campos em `conexoes_bancarias.data`:

| Campo | Uso |
|---|---|
| `apelido` | nome dado pela agência |
| `ultimaSincronizacaoEm` | data e hora ISO da última execução com sucesso |
| `ultimaJanela` | `{de, ate}` coberto |
| `proximaSincronizacaoEm` | usado pelo agendador para montar a fila |
| `falhasConsecutivas` | zera a cada sucesso, alerta a partir de 3 |
| `ultimoErro` | `{motivo, mensagemUsuario, em}`, nunca o erro cru do banco |
| `contaDetectada` | agência e conta que o banco devolveu na validação |
| `usoMisto` | conta pessoal do sócio usada para despesa da empresa |

Campos acrescentados em `extrato_bancario.data`, sem quebrar o que existe:

| Campo | Uso |
|---|---|
| `id_externo` | identificador do banco, quando houver |
| `origem` | `ARQUIVO` ou `SINCRONIZACAO` |
| `conexao_id` | qual conexão trouxe a linha |
| `pendente` | lançamento não efetivado |
| `ocorrencia_no_dia` | contador que desempata lançamentos idênticos (corrige D2) |

---

## 7. Deduplicação

Reaproveita `chaveLinha` de `importar/route.ts:23`, corrigida em três pontos.

**Regra 1, com identificador do banco.** Chave = `${contaId}|ext:${idExterno}`. Vale para Asaas, Mercado Pago, Cora, Sicredi, Stone e BS2.

**Regra 2, sem identificador.** Chave = `${contaId}|fp:${data}|${centavos}|${descricaoNormalizada}|${ocorrencia}`, onde `descricaoNormalizada` é caixa baixa, sem acento e sem espaço duplicado, e `ocorrencia` é o índice da linha entre as idênticas do mesmo dia, na ordem em que o banco devolveu. Vale para Inter, Sicoob e Santander.

O campo `ocorrencia` é o que corrige D2. Sem ele, dois PIX de R$ 500,00 recebidos no mesmo dia com a mesma descrição colapsam em um, e a segunda entrada real desaparece contada como duplicada.

**A chave é gravada em coluna e protegida por índice único.** Isso corrige D1: a garantia deixa de ser uma leitura antes do `BEGIN` e passa a ser uma restrição do banco. A inserção usa `ON CONFLICT (tenant_id, chave_dedup) DO NOTHING` e conta as linhas realmente inseridas por `rowCount`, não por comparação prévia.

**Transição de pendente para efetivado.** Quando a chave já existe e a linha nova chega com `pendente: false` enquanto a gravada está `pendente: true`, a linha é **atualizada**: muda `pendente`, `descricao` e `saldoApos`, preserva `id`, `status_conciliacao` e qualquer vínculo já feito. É o único caso de atualização de linha de extrato. No Santander isso é frequente por desenho, já que efetivado e provisionado vêm de endpoints separados.

**Descrição que muda entre sincronizações.** Quando não há `idExterno`, a busca de candidata usa só `data` e `valor`. Se houver exatamente uma candidata no mesmo dia, mesmo valor e sem vínculo, trata como a mesma linha e atualiza a descrição. Havendo mais de uma, o desempate é por `ocorrencia`.

**O campo `saldo` da linha para de ser calculado por acumulação de arquivo** (corrige D7). Passa a receber o `saldoApos` do banco quando existir, e `null` quando não existir. Número inventado é pior que campo vazio.

---

## 8. Agendamento

| Item | Decisão |
|---|---|
| Gatilho | `POST /api/integracoes/bancarias/sincronizar`, com `Authorization: Bearer <INTEGRACOES_CRON_SECRET>` |
| Frequência do gatilho | de hora em hora |
| Frequência por conta | uma vez por dia por padrão, configurável de 1 a 4 |
| Seleção | `proximaSincronizacaoEm <= agora` e `status = ATIVA`, no máximo 20 por execução |
| Janela | de `ultimaSincronizacaoEm` menos 3 dias até hoje. Carga inicial de 90 dias, em blocos que respeitem o teto de cada banco (Inter 90, Mercado Pago 60, Sicoob 31, PagBank 1) |
| Execução única | id `sinc:${conexaoId}:${dataHoraTruncadaEmHora}` como chave primária de `sincronizacoes_bancarias`, o que impede execução dupla na mesma hora |
| Serialização | `pg_advisory_xact_lock(hashtext(conexaoId))`, mesmo padrão já usado no CRM para automação entre funis |
| Backoff | falha 1 adia 1 hora, falha 2 adia 4 horas, falha 3 em diante adia 24 horas e marca a conexão como `ATENCAO` |
| Rate limit | espaçamento por credencial dentro do adapter. No Inter, no máximo 10 por minuto |
| Credencial expirada | conexão vai para `EXPIRADA`, sincronização para, agência é avisada, importação por arquivo continua disponível |
| Relatório assíncrono | Mercado Pago, Efí e PagBank usam duas passagens: uma execução solicita, a seguinte busca. O estado fica em `sincronizacoes_bancarias.data.referencia` |

---

## 9. Motor de conciliação

Cascata de regras. A primeira que casar com score suficiente vence.

| Regra | Condição | Score |
|---|---|---|
| R1 exata | valor idêntico e data do lançamento igual à do vencimento | 100 |
| R2 valor e janela | valor idêntico e vencimento dentro da tolerância de dias | 85 |
| R3 valor, janela e nome | R2 mais nome do cliente ou fornecedor contido na descrição | 95 |
| R4 identificador Pix | `txid` ou identificador do Pix casando com o gravado no título | 98 |
| R5 aproximada | diferença de valor até a tolerância e dentro da janela | 70 |
| R6 agrupada | soma de 2 a 5 títulos em aberto do mesmo cliente bate com o lançamento | 65 |
| R7 parcial | lançamento menor que o título, mesmo cliente, dentro da janela | 60 |
| R8 transferência | transferência efetivada com mesmo valor e data entre contas do tenant | 90 |
| R9 líquido de adquirente | lançamento bate com o valor da venda menos a taxa configurada da maquininha | 55 |

Parâmetros por tenant: tolerância de dias, padrão 3. Tolerância de valor, padrão zero. Score mínimo para sugerir, padrão 60.

**Ambiguidade.** Duas ou mais candidatas com score dentro de 5 pontos: nenhuma é sugerida. A linha vai para a fila de pendências com as candidatas listadas para escolha manual. Sugerir a errada custa mais caro que não sugerir.

**Baixa parcial passa a existir de verdade** (corrige D3). O motor nunca força `RECEBIDO`. Ele calcula o novo `valor_recebido` **somando** ao acumulado e deixa `calcularMovimentos` decidir o movimento de caixa, que é o contrato de `caixa-atomico.ts:134`. Status vira `PARCIAL` quando o acumulado ainda é menor que `valor_final`, respeitando a tolerância de 0,005 já usada em `receber/page.tsx:154`.

**Baixa e marcação viram uma transação só** (corrige D4). Hoje são duas requisições. Passa a ser uma rota `POST /api/conciliacao/aplicar` que abre transação, marca a linha, aplica a baixa pelo caminho existente e grava `audit_log`, tudo ou nada. Toda escrita confere `rowCount` (corrige D5).

**Reversão passa a existir** (corrige D6). `POST /api/conciliacao/desfazer` devolve a linha para `PENDENTE`, limpa o vínculo e reverte a baixa **pelo mesmo caminho que move o saldo**, com delta negativo, nunca por escrita direta. É a regra estabelecida na auditoria de 2026-09-01.

**Ruído que não é receita nem despesa.** Tarifa, estorno, transferência entre contas próprias, aplicação automática e rendimento recebem classificação `NAO_OPERACIONAL` e ficam fora do fluxo de caixa operacional. Detecção por regra de descrição configurável por tenant, com lista inicial semeada. Falso positivo aqui é barato de corrigir e caro de ignorar.

**Toda ação grava `audit_log`** (corrige D10): conciliou, desfez, importou, sincronizou, conectou, desconectou. A tabela existe desde sempre e nada escreve nela.

---

## 10. Onboarding, tela a tela

Tela única, quatro passos, validação antes de salvar. O texto muda por adapter, o componente não.

**Passo 1, escolher a conta.** Lista contas de `contas_bancarias` sem conexão ativa. Marca opcional de uso misto, para a conta pessoal do sócio.

**Passo 2, instruções do banco.** Texto fiel ao caminho real. Para o Inter, com a advertência que mais gera suporte:

> No Internet Banking PJ do Inter, vá em `Integrar` e depois `Nova Integração`. Dê um nome, informe seu CNPJ na descrição e selecione a conta. Marque **somente** `API Banking` com a permissão de consultar extrato e saldo. Confirme por SMS. Quando a integração aparecer como aprovada, vá em `Minhas Integrações`, clique nos três pontinhos em `Ações` e escolha `Download chave e certificado`. **Descompacte o arquivo e envie a chave e o certificado separados, não o compactado.** Guarde os arquivos: eles só aparecem uma vez.

**Passo 3, colar as credenciais.** Campos renderizados a partir de `camposCredencial()`, sem nada específico de banco no componente. Arquivos lidos no navegador e enviados no corpo por HTTPS, nunca pela rota de upload pública.

**Passo 4, validar.** Chamada real na hora. Mensagens acionáveis:

| Situação | Mensagem |
|---|---|
| Sucesso | Conexão validada. Conta 0001 / 12345 6 reconhecida pelo banco. |
| Escopo faltando | A integração foi criada sem permissão de consultar extrato e saldo. Refaça marcando essa permissão. |
| Certificado e chave trocados | O conteúdo do certificado e da chave parecem invertidos. Confira qual arquivo foi enviado em cada campo. |
| Compactado enviado | Envie os arquivos separados, não o compactado. |
| Credencial inválida | O banco recusou o identificador ou o segredo. Copie os dois novamente na tela de detalhes da integração. |
| Certificado vencido | Este certificado expirou em DD/MM/AAAA. Gere uma nova integração no banco. |
| Plano não contratado | Este banco só libera a integração no plano pago. Verifique o plano da sua conta antes de continuar. |

Estados na tela de contas bancárias: `Conectada, sincronizada às HH:MM`, `Atenção, N falhas seguidas`, `Expirada, reconecte`, `Sem conexão automática`.

**Renovação de certificado.** O do Inter vale 12 meses e não há botão de renovar: é preciso recriar a integração. `expiraEm()` grava a data. Aviso aos 30 dias, aviso persistente aos 7, e no vencimento a conexão vai para `EXPIRADA`. Renovar troca só o envelope de segredo: `conexao_id` não muda e o histórico é preservado inteiro.

**Onde avisar.** Hoje só existe o sino interno (`src/lib/notificacoes.ts`), com 4 tipos, todos de proposta, e polling de 60 segundos. Não há e-mail nem WhatsApp no projeto. O aviso de certificado vencendo entra como tipo novo no sino, e a limitação fica registrada: se a agência não abrir o sistema, não vai ver.

---

## 11. Fases de entrega

### Fase 0, corrigir o que já está quebrado
Os dez defeitos da seção 2.2, mais teste de importação e conciliação, que hoje é zero.
**Valor:** a conciliação manual para de duplicar, de perder lançamento e de destruir baixa parcial.
**Aceite:** importar o mesmo arquivo duas vezes em paralelo não duplica; dois Pix iguais no mesmo dia entram como duas linhas; conciliar parcial mantém `PARCIAL` e soma ao acumulado; desfazer devolve o saldo; toda escrita confere `rowCount`; `audit_log` registra; `npm test` cobre importação e conciliação.

### Fase 1, fundação de segurança
Cifra AES 256 GCM, tabelas de conexão e segredo, índices que faltam.
**Valor:** nenhum visível. É a fase que não pode ser pulada.
**Aceite:** segredo gravado é ilegível em `SELECT *`; cifra e decifra com teste; `INTEGRACOES_MASTER_KEY` documentada no Coolify e no backup.

### Fase 2, contrato e adapter de arquivo
Interface do adapter e adapter de OFX e CSV embrulhando o parser existente, sem mudar comportamento.
**Valor:** a importação atual passa a viver no contrato novo e nada regride.
**Aceite:** os testes da Fase 0 continuam verdes com o parser embrulhado.

### Fase 3, primeiro adapter de API
**Inter**, por ser gratuito, com onboarding sem gerente e sem certificado comprado. Onboarding, validação imediata, botão `Sincronizar agora`. Sem agendamento.
**Valor:** a agência conecta e traz 90 dias com um clique.
**Aceite:** conexão validada com conta real; 90 dias entram sem duplicar mesmo com Pix repetidos; credencial errada devolve a mensagem certa; nenhum segredo em log ou resposta.

### Fase 4, agendamento
Endpoint de sincronização, seleção por vencimento, backoff, histórico, execução única por hora.
**Valor:** o extrato entra sozinho todo dia.
**Aceite:** duas chamadas na mesma hora processam uma vez; três falhas marcam `ATENCAO`; janela sobreposta não duplica.

### Fase 5, motor de conciliação com score
Cascata R1 a R9, tolerância por tenant, ambiguidade, parcial, agrupada e transferência.
**Valor:** a fila de pendências encolhe.
**Aceite:** cada regra com teste numérico; ambiguidade não sugere; reversão devolve o saldo pelo caminho que move o caixa.

### Fase 6, segundo e terceiro adapters
**Sicoob** e **Santander**, decididos pela distribuição real das agências (pergunta aberta 2). Ambos exigem ICP-Brasil A1, que é custo da agência e precisa estar claro no onboarding.
**Valor:** cobertura além do Inter.
**Aceite:** Santander soma efetivados e provisionados sem duplicar na transição; Sicoob respeita a janela de 31 dias por mês.

### Fase 7, saúde da conexão
Aviso de vencimento, estado na interface, fallback para arquivo, alerta de falha.
**Valor:** a agência descobre o problema antes de sentir falta do extrato.
**Aceite:** aviso aos 30 e aos 7 dias; conexão expirada não impede importar arquivo.

**Fora de escopo nesta rodada, com motivo:**

| Item | Motivo |
|---|---|
| Agenda de recebíveis de adquirente | é o maior ganho para agência de viagens, mas é outro domínio: Cielo, Rede, Getnet e as registradoras CERC e Núclea. Merece rodada própria, não um apêndice desta |
| Cartão de crédito corporativo | tem fatura, não extrato, com ciclo de fechamento próprio |
| Open Finance por agregador | custo fixo de R$ 2.500,00/mês não fecha com a base atual. Reavaliar quando o número de agências justificar |
| Câmbio de turismo | tesouraria paralela real do setor, mas nenhum dos bancos de câmbio pesquisados tem API de extrato para correntista |

---

## 12. Cobertura esperada

| Modo | Cobertura | Observação |
|---|---|---|
| Arquivo OFX ou CSV | universal | funciona em qualquer banco, custa trabalho manual |
| API, bancos da Fase 3 e 6 | Inter, Sicoob, Santander | três dos dez com autoatendimento |
| API, ampliação possível | mais 7 bancos | Asaas, Mercado Pago, Cora, Efí, PagBank, BTG, Sicredi, com as ressalvas de custo da seção 3 |
| Sem automação possível | Nubank PJ, Caixa, Itaú, Banco do Brasil, Bradesco na prática | os cinco onde está boa parte da base, por gerente, certificado pago ou ausência de API |

O número exato de agências cobertas depende da distribuição por banco, que ainda não temos. É a pergunta aberta 2, e sem ela qualquer percentual aqui seria invenção.

---

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| mTLS por tenant em Node sem vazar entre requisições | um `https.Agent` por conexão, criado sob demanda, em cache com TTL curto, chaveado por `conexaoId`. Nunca um agente global mutável |
| Chave privada em memória | decifrada só dentro do escopo da chamada, nunca anexada a log, erro ou payload. `FalhaColeta` carrega apenas `mensagemUsuario` |
| Rate limit do Inter, 10 por minuto | espaçamento por credencial no adapter e no máximo 20 contas por execução |
| Janela de 90 dias na carga inicial | blocos do mais recente para o mais antigo, limite de 1 ano configurável |
| Inter sem identificador de lançamento | impressão digital com contador de ocorrência mais índice único no banco |
| Santander com efetivado e provisionado separados | as duas leituras na mesma coleta, com transição de pendente tratada como atualização |
| Mercado Pago assíncrono por relatório | fluxo em duas passagens, com referência persistida |
| Custo escondido de plano | `PLANO_NAO_CONTRATADO` como motivo de falha próprio, com mensagem que diz para conferir o plano |
| Descrição instável entre sincronizações | impressão digital por data e valor, descrição só para desempate |
| Tarifa, estorno e aplicação poluindo o caixa | classificação `NAO_OPERACIONAL` fora do fluxo operacional |
| Conta pessoal do sócio usada pela empresa | marca `usoMisto` na conexão, com a conciliação avisando que a conta tem movimento pessoal |
| Perda da chave mestra | runbook, variável no backup de configuração do Coolify. Sem ela, reconexão manual de todas as agências |
| Três saldos concorrentes no sistema | a Fase 0 define qual é a fonte da verdade e passa a confrontar com o saldo que o banco informa |
| LGPD | extrato é dado financeiro do titular tenant. Base legal: execução de contrato. Finalidade: conciliação. Retenção: enquanto durar o contrato mais o prazo fiscal de 5 anos. Desconectar apaga a credencial na hora e preserva o extrato já conciliado, que é registro contábil. A política de retenção ao cancelar o plano **não existe no repositório** e precisa ser definida |

---

## 14. Perguntas abertas

1. **Agendador.** O Coolify deste servidor expõe Scheduled Tasks para esta aplicação? Se não, aceita um cron externo gratuito chamando a URL, ou prefere um processo próprio?
2. **Distribuição por banco.** Quantas agências ativas usam cada banco? Define a Fase 6 e é o único jeito de estimar cobertura real. Sem isso, o segundo adapter é escolhido no escuro.
3. **Conta real do Inter.** A Fase 3 não fecha sem uma conta PJ real, porque o sandbox não reproduz extrato com movimento de verdade. Existe uma disponível?
4. **Conciliação automática.** O plano exige confirmação humana em toda conciliação. Aceita que score 100 concilie sozinho depois que a Fase 5 estabilizar, ou prefere confirmação sempre?
5. **Adquirente.** A agenda de recebíveis de cartão é, pelo dado do setor, o maior ganho possível. Quer que ela vire a próxima rodada depois desta, ou antes da Fase 6?
6. **Retenção de dados.** Qual a política ao cancelar o plano? Não há nada no repositório e a resposta afeta o texto de LGPD.
7. **Certificado ICP-Brasil.** Sicoob, Santander, Bradesco e Banco do Brasil exigem certificado A1 comprado pela agência. O produto assume esse custo, repassa, ou simplesmente não oferece esses bancos?

---

## 15. Checklist do próprio plano

| Exigência | Situação |
|---|---|
| Toda afirmação sobre o código cita arquivo e linha | sim |
| Toda afirmação sobre API de banco separada entre fato e suposição | sim, com verificador cético independente por banco |
| Contrato cobre os três modos sem condicional por fornecedor fora dos adapters | sim, por capacidades declaradas |
| Resposta explícita para dedup, pendente para efetivado e reprocessamento | sim, seção 7 |
| Decisão explícita sobre onde e como a chave privada é cifrada | sim, seção 4.4 |
| Fluxo de renovação de certificado com aviso antecipado | sim, seção 10 |
| Fallback para arquivo quando a conexão falha | sim, Fase 7 |
| Cada fase entrega valor sozinha e tem aceite verificável | sim, seção 11 |
| O plano diz quanto da base fica sem automação | parcialmente: nomeia os bancos sem cobertura, mas o percentual depende da pergunta aberta 2 |
| Nenhuma etapa exige agregador pago | sim |
| Migração proposta como SQL para revisão humana | sim, seção 6 |
