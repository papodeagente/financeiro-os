'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatarEixoBRL } from '@/lib/escala';
import { Money, type MoneyProps } from '@/components/fin/Money';

/**
 * Ocultar os valores da tela sem desmontar a tela.
 *
 * POR QUE EXISTE. Este painel é feito para ficar aberto na mesa do dono, e a
 * mesa do dono tem gente passando: contador, estagiário, cliente, câmera de
 * reunião. Sem um jeito de esconder, a pessoa fecha o painel — e um painel
 * fechado não informa nada.
 *
 * O QUE ESTE COMPONENTE NÃO É: segurança. Os números continuam no payload que
 * o navegador recebeu. É discrição visual, e é só isso que promete ser. Quem
 * não pode VER o financeiro é barrado na rota, por permissão, não aqui.
 *
 * A máscara atravessa todos os gráficos porque a formatação de dinheiro é
 * injetada por prop em cada um: basta trocar a função, e nenhum componente de
 * desenho precisa saber que existe modo oculto.
 */

const MASCARA = 'R$ ••••••';
/** Máscara curta, para o tick de eixo, onde 'R$ ••••••' não caberia. */
const MASCARA_CURTA = 'R$ •••';

type Contexto = {
  oculto: boolean;
  alternar: () => void;
  /** A função de formatação que TODO gráfico e todo número da tela deve usar. */
  formatar: (v: number) => string;
  /**
   * A abreviação do TICK DE EIXO.
   *
   * Sem ela o modo oculto mascara as barras e deixa a escala em reais na tela:
   * quem olha por cima do ombro lê a ordem de grandeza do caixa no eixo, que é
   * exatamente o que o botão prometeu esconder.
   */
  formatarEixo: (v: number) => string;
};

const PrivacidadeCtx = React.createContext<Contexto>({
  oculto: false,
  alternar: () => {},
  formatar: v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  formatarEixo: formatarEixoBRL,
});

const CHAVE = 'fin:valores-ocultos';

export function PrivacidadeProvider({ children }: { children: React.ReactNode }) {
  const [oculto, setOculto] = React.useState(false);

  // A preferência é lida depois da montagem, nunca no estado inicial: ler
  // localStorage na primeira renderização faz o servidor e o cliente
  // discordarem e o React reclamar no hidrate.
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(CHAVE) === '1') setOculto(true);
    } catch {
      // Navegador com armazenamento bloqueado: o painel abre visível, que é o
      // padrão. Preferência é conveniência, não pode derrubar a tela.
    }
  }, []);

  const alternar = React.useCallback(() => {
    setOculto(atual => {
      const novo = !atual;
      try {
        window.localStorage.setItem(CHAVE, novo ? '1' : '0');
      } catch {
        // Idem: não conseguir lembrar não impede de ocultar agora.
      }
      return novo;
    });
  }, []);

  const valor = React.useMemo<Contexto>(
    () => ({
      oculto,
      alternar,
      formatar: (v: number) =>
        oculto ? MASCARA : Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      formatarEixo: (v: number) => (oculto ? MASCARA_CURTA : formatarEixoBRL(v)),
    }),
    [oculto, alternar],
  );

  return <PrivacidadeCtx.Provider value={valor}>{children}</PrivacidadeCtx.Provider>;
}

export function usePrivacidade(): Contexto {
  return React.useContext(PrivacidadeCtx);
}

/** O botão. Ícone MAIS rótulo: um olho cortado sozinho não diz o que faz. */
export function BotaoDePrivacidade({ className }: { className?: string }) {
  const { oculto, alternar } = usePrivacidade();
  const Icone = oculto ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={oculto}
      className={cn(
        'fin-t-body inline-flex h-11 items-center gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-3 text-[var(--fin-text-2)] transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
        className,
      )}
    >
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      {oculto ? 'Mostrar valores' : 'Ocultar valores'}
    </button>
  );
}

/**
 * Dinheiro que respeita o modo oculto.
 *
 * Envelopa o Money do sistema em vez de reimplementá-lo: assim continua
 * herdando tabular-nums, largura mínima, estado de carregamento e a recusa de
 * pintar R$ 0,00 quando o valor não é conhecido.
 */
export function ValorProtegido({ valor, ...resto }: MoneyProps) {
  const { oculto } = usePrivacidade();
  if (!oculto) return <Money valor={valor} {...resto} />;
  return (
    <span
      aria-label="valor oculto"
      className={cn(
        'inline-block tabular-nums text-[var(--fin-text-3)]',
        resto.size === 'resposta' ? 'fin-t-resposta' : resto.size === 'metric' ? 'fin-t-metric' : 'fin-t-body-strong',
        resto.className,
      )}
    >
      {MASCARA}
    </span>
  );
}

export default PrivacidadeProvider;
