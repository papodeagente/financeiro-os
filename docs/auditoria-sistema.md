# Auditoria do sistema

A página `/config/auditoria` consulta o histórico persistido, restrito a administradores da agência. Superadministradores mantêm sua identidade ao acessar uma agência pelo suporte. O tenant da sessão limita listagem, filtros e exportação.

## Captura

`audit-schema.ts` instala triggers de INSERT, UPDATE e DELETE nas tabelas de negócio com `tenant_id` e nas tabelas administrativas globais. A lista efetiva e a data de ativação ficam em `audit_config`, registro `capture-v1`. Cache e o histórico derivado `grupo_eventos` são excluídos para evitar duplicação. Uma operação que modifica várias entidades produz um evento por registro, correlacionado pelo identificador da requisição.

O evento acompanha a mesma transação da alteração. Rollback não deixa um evento de sucesso e updates sem mudança relevante não geram duplicações. `AuditPool` instala a identidade da sessão validada antes de entregar cada conexão, inclusive para `pool.query` e transações com `pool.connect`. O tenant vem da linha alterada, não do corpo da requisição. Migrações são identificadas como Sistema.

Eventos complementares registram login, falhas de acesso com conta/agência conhecida, logout, início/fim do acesso de suporte, visualização da chave CRM, uploads/comprovantes, imagens importadas/geradas e exportação da própria auditoria. Tentativas com conta desconhecida não são atribuídas a uma agência inventada.

## Proteções e limites

- O endpoint de auditoria não aceita POST, PUT, PATCH ou DELETE. Triggers também impedem alteração, exclusão e TRUNCATE do histórico.
- Senhas, tokens, certificados, credenciais e conteúdos brutos de integrações são mascarados antes de persistir. Mudanças nesses campos continuam indicadas, sem revelar seus valores.
- Textos extensos, listas aninhadas e profundidade têm limites explícitos no conteúdo exibido; os eventos continuam registrados. O histórico não serve como backup integral de documentos.
- Não se reconstitui histórico anterior à ativação nem se considera cada navegação de página uma movimentação. Downloads gerados apenas no navegador, fora da exportação de auditoria, não são confirmados pelo servidor.
- Listagem usa paginação/filtros no servidor, ordenação estável e snapshot para total/página. A tela atualiza a cada 45 segundos quando visível.
- CSV aplica os mesmos filtros, escapa separadores/aspas/fórmulas e exporta até 50.000 registros. Acima disso, solicita um período menor, sem truncar silenciosamente.

## Validação

`npm run test:audit` executa triggers SQL reais em PGlite, handlers de sessão/arquivos, a API real de listagem/exportação e o Pool, além da inicialização completa e segundo boot. Também roda automaticamente após `npm test`.
