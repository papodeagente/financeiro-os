import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { AuditContext } from './audit-context';

type CheckoutCallback = (err: Error | undefined, client: PoolClient | undefined,
  done: (release?: Error | boolean) => void) => void;

/**
 * Toda retirada do pool instala o contexto ANTES de entregar a conexão.
 * Também atende o callback usado internamente por pg.Pool.query(). Um evento
 * pool.on('acquire', async ...) não serviria: pg não aguarda esse listener.
 */
export class AuditPool extends Pool {
  private readonly resolveContext: () => Promise<AuditContext>;

  constructor(config: PoolConfig, resolveContext: () => Promise<AuditContext>) {
    super(config);
    this.resolveContext = resolveContext;
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: CheckoutCallback): void;
  override connect(callback?: CheckoutCallback): Promise<PoolClient> | void {
    const checkout = async () => {
      // Capturado no contexto da chamada, antes de aguardar uma conexão livre.
      const context = await this.resolveContext();
      const client = await super.connect();
      try {
        // Escopo de sessão: BEGIN/COMMIT/ROLLBACK do chamador preservam o ator.
        // A próxima retirada SEMPRE sobrescreve o JSON inteiro, até para Sistema.
        await client.query('SELECT set_config($1, $2, false)',
          ['app.audit_context', JSON.stringify(context)]);
        return client;
      } catch (error) {
        // Falha fechada: conexão sem atribuição nunca executa a mutação.
        client.release(error instanceof Error ? error : true);
        throw error;
      }
    };
    const pending = checkout();
    if (!callback) return pending;
    void pending.then(
      client => callback(undefined, client, client.release.bind(client)),
      error => callback(error instanceof Error ? error : new Error(String(error)), undefined, () => {}),
    );
  }
}
