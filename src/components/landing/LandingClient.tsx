'use client';

/**
 * Landing page pública do Entur OS Fin.
 *
 * A página antiga vendia outro produto: falava de propostas, voos e hotéis,
 * que são do CRM. Este sistema é o financeiro da agência — contas a receber e
 * a pagar, fluxo de caixa, DRE, conciliação bancária, nota fiscal de
 * agenciamento, comissão, folha. A página agora conta isso.
 *
 * A tese, e o motivo de a conta vir antes do texto: numa venda agenciada a
 * maior parte do dinheiro só PASSA pela conta da agência. Ver
 * src/components/landing/Razao.tsx.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, Loader2 } from 'lucide-react';

import { Logo } from '@/components/Logo';
import { Razao } from './Razao';

interface Plano {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  preco_mensal: number;
  preco_anual: number;
  moeda: string;
  destaque: boolean;
  ordem: number;
  limites: Record<string, unknown>;
  features: string[];
}

/**
 * O mês de uma agência, na ordem em que ele acontece.
 *
 * A numeração aqui não é enfeite: é um ciclo de verdade, e cada etapa é uma
 * tela que existe no sistema. Por isso o trilho tem traço ligando uma à
 * outra, e o traço para na última — depois dela o mês recomeça.
 */
const MES = [
  { etapa: 'Entra', titulo: 'Contas a receber', desc: 'A parcela que o cliente pagou, não a que ele prometeu.' },
  { etapa: 'Sai', titulo: 'Contas a pagar', desc: 'Repasse a fornecedor, cartão corporativo, folha.' },
  { etapa: 'Confere', titulo: 'Conciliação', desc: 'O extrato do banco casado com o que o sistema registrou.' },
  { etapa: 'Declara', titulo: 'Nota fiscal', desc: 'NFS-e da comissão, com o certificado já conectado.' },
  { etapa: 'Divide', titulo: 'Comissões', desc: 'A escala de cada vendedor, calculada sobre o mês.' },
  { etapa: 'Fecha', titulo: 'DRE e fluxo de caixa', desc: 'O que sobrou, e o que vai sobrar nos próximos meses.' },
];

/**
 * As perguntas que a dona da agência faz, e a tela que responde.
 *
 * Pergunta primeiro, recurso depois: ninguém procura "DRE gerencial", procura
 * saber se o mês fechou no azul.
 */
const RESPOSTAS = [
  {
    pergunta: 'Essa viagem deu lucro?',
    resposta: 'Rentabilidade por venda',
    desc: 'A margem de cada venda depois do repasse ao fornecedor, da comissão do vendedor e da taxa da plataforma. Não é o valor do pacote.',
  },
  {
    pergunta: 'Vou ter dinheiro em novembro?',
    resposta: 'Fluxo de caixa projetado',
    desc: 'Recebíveis, contas a pagar, folha e parcelas de cartão no mesmo calendário. Mês atual, próximo, 2 meses ou período que você escolher.',
  },
  {
    pergunta: 'Quanto eu pago de comissão esse mês?',
    resposta: 'Comissões e metas',
    desc: 'A escala é aplicada sobre o acumulado do mês do vendedor, não venda a venda. A comissão vira conta a pagar programada na data que a empresa define.',
  },
  {
    pergunta: 'O banco bate com o sistema?',
    resposta: 'Conciliação bancária',
    desc: 'Importa o extrato e casa com os lançamentos. O que não casou fica separado, com o motivo.',
  },
  {
    pergunta: 'Quanto custa trazer um cliente?',
    resposta: 'CAC por canal',
    desc: 'O investimento de marketing contra as vendas que ele gerou, com cenários para comparar.',
  },
  {
    pergunta: 'Onde foi parar o dinheiro do cartão?',
    resposta: 'Inteligência do cartão',
    desc: 'Sobe a fatura em PDF e a IA lança as contas, inclusive as parcelas. A parcela do mês seguinte não entra duas vezes.',
  },
];

/** O que só existe aqui porque o sistema foi feito para agência de viagem. */
const PARA_AGENCIA = [
  {
    titulo: 'Nota de agenciamento, não do valor cheio',
    desc: 'A nota sai da comissão. Emitir sobre o pacote inteiro faz a agência pagar ISS sobre dinheiro que só passou pela conta dela.',
  },
  {
    titulo: 'A venda do CRM chega inteira',
    desc: 'Produto, cliente, vendedor e custo de cada fornecedor. O custo vira conta a pagar; a venda vira conta a receber.',
  },
  {
    titulo: 'Hotmart, Asaas e Pagar.me',
    desc: 'A venda feita na plataforma entra sozinha, com a taxa separada do valor recebido. Cada agência conecta a própria conta.',
  },
  {
    titulo: 'Folha e colaboradores',
    desc: 'Salário, encargos e provisões de 13º e férias entram na previsão de caixa, não só no fim do mês.',
  },
];

export function LandingClient() {
  const router = useRouter();
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [carregandoPlanos, setCarregandoPlanos] = useState(true);

  useEffect(() => {
    /**
     * A PÁGINA NÃO ESPERA A SESSÃO PARA APARECER.
     *
     * Antes, o conteúdo inteiro ficava atrás de um spinner até a checagem
     * de sessão responder. Numa página de marketing isso custa caro: sem
     * JavaScript — leitor de tela antigo, bloqueador, robô de busca — o
     * visitante recebia uma tela em branco, e o Google indexava nada.
     *
     * Quem chega em '/' é anônimo na esmagadora maioria das vezes. Então a
     * página é desenhada para ele e o usuário logado é redirecionado por
     * cima, vendo a landing por um instante. O comentário do arquivo
     * original já tratava esse flash como aceitável; ele deixou de ser
     * preço de nada e passou a ser o preço de a página existir sem JS.
     */
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(dados => { if (dados?.userId) router.replace('/dashboard'); })
      .catch(() => { /* anônimo é o caminho normal: a página já está na tela */ });

    fetch('/api/planos')
      .then(r => r.json())
      .then((dados: Plano[]) => {
        if (Array.isArray(dados)) setPlanos(dados);
        setCarregandoPlanos(false);
      })
      .catch(() => setCarregandoPlanos(false));
  }, [router]);

  useRevelacaoNoScroll();

  return (
    <div className="lp min-h-screen">
      <header className="sticky top-0 z-50 border-b border-[#E3E8F0] bg-[#F7F8FC]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo variant="sidebar" href="/" />
          <nav className="flex items-center gap-1">
            <Link
              href="#planos"
              className="hidden rounded-lg px-3 py-2 text-sm text-[#5B6878] transition-colors hover:text-[#1A1A1A] sm:inline-flex"
            >
              Planos
            </Link>
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm text-[#5B6878] transition-colors hover:text-[#1A1A1A]"
            >
              Entrar
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#004aad] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#003B8A]"
            >
              Criar conta <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Herói: a tese e a conta ──────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <p className="lp-eyebrow">Financeiro para agência de viagem</p>
            {/* Duas linhas declaradas, não quebra de sorte: deixar o
                navegador escolher onde parte punha "é" sozinho numa linha. */}
            <h1 className="lp-display mt-5 text-[2.5rem] sm:text-[3.25rem] lg:text-[3.5rem]">
              <span className="block">Vender R$ 20.000</span>
              <span className="block">não é faturar R$ 20.000.</span>
            </h1>
            <div className="mt-6 h-[3px] w-14 bg-[#004aad]" />
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-[#475569]">
              Na venda agenciada, o repasse ao fornecedor passa pela sua conta e não é
              sua receita. O Entur OS Fin separa o que é repasse do que é seu, emite a
              nota sobre a comissão e fecha o mês em cima do que sobrou.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#004aad] px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#003B8A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004aad]"
              >
                Começar grátis por 14 dias <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="#planos"
                className="inline-flex items-center justify-center rounded-xl border border-[#E3E8F0] bg-white px-6 py-3.5 font-semibold text-[#475569] transition-colors hover:border-[#C9D3E3] hover:text-[#1A1A1A]"
              >
                Ver planos
              </Link>
            </div>
            <p className="mt-4 text-xs text-[#5B6878]">
              Sem cartão de crédito · Cancela quando quiser
            </p>
          </div>

          <Razao />
        </div>
      </section>

      {/* ── O mês inteiro ────────────────────────────────────────────── */}
      <section className="border-t border-[#E3E8F0] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="lp-reveal">
            <p className="lp-eyebrow">O mês inteiro</p>
            <h2 className="lp-display mt-4 max-w-2xl text-[1.875rem] sm:text-[2.25rem]">
              Do dinheiro que entra ao mês que fecha.
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#475569]">
              Seis telas, na ordem em que o mês acontece. Nenhuma delas pede que você
              redigite o que já está em outra.
            </p>
          </div>

          <ol className="lp-trilho mt-12 grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3 lg:grid-cols-6">
            {MES.map((m, i) => (
              <li
                key={m.titulo}
                className="lp-etapa lp-reveal"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <span className="lp-num flex size-[34px] items-center justify-center rounded-full border border-[#E3E8F0] bg-white text-[11px] text-[#004aad]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="lp-eyebrow mt-4">{m.etapa}</p>
                <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-[#1A1A1A]">
                  {m.titulo}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#5B6878]">{m.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── As perguntas ─────────────────────────────────────────────── */}
      <section className="border-t border-[#E3E8F0]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="lp-reveal">
            <p className="lp-eyebrow">O que ele responde</p>
            <h2 className="lp-display mt-4 max-w-2xl text-[1.875rem] sm:text-[2.25rem]">
              As perguntas que a planilha não responde sozinha.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {RESPOSTAS.map((r, i) => (
              <article
                key={r.pergunta}
                className="lp-cartao lp-reveal p-5"
                style={{ transitionDelay: `${(i % 3) * 70}ms` }}
              >
                <p className="text-[15px] font-semibold leading-snug text-[#1A1A1A]">
                  {r.pergunta}
                </p>
                <p className="lp-eyebrow mt-3" style={{ color: '#004aad' }}>
                  {r.resposta}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[#5B6878]">{r.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feito para agência ───────────────────────────────────────── */}
      <section className="border-t border-[#E3E8F0] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div className="lp-reveal">
              <p className="lp-eyebrow">Por que não serve um financeiro genérico</p>
              <h2 className="lp-display mt-4 text-[1.875rem] sm:text-[2.25rem]">
                Quatro coisas que só existem aqui.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#475569]">
                Um sistema financeiro comum trata a venda como receita. Numa agência,
                isso infla o faturamento, infla o imposto e esconde a margem.
              </p>
            </div>

            <div className="grid gap-px overflow-hidden rounded-xl border border-[#E3E8F0] bg-[#E3E8F0] sm:grid-cols-2">
              {PARA_AGENCIA.map((p, i) => (
                <div
                  key={p.titulo}
                  className="lp-reveal bg-white p-5"
                  style={{ transitionDelay: `${i * 70}ms` }}
                >
                  <h3 className="text-[15px] font-semibold leading-snug text-[#1A1A1A]">
                    {p.titulo}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#5B6878]">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Planos ───────────────────────────────────────────────────── */}
      <section id="planos" className="border-t border-[#E3E8F0] scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="lp-reveal">
            <p className="lp-eyebrow">Planos</p>
            <h2 className="lp-display mt-4 text-[1.875rem] sm:text-[2.25rem]">
              Preço por agência, não por usuário.
            </h2>
          </div>

          {carregandoPlanos ? (
            <div className="mt-12 flex items-center gap-2 text-[#5B6878]">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span className="text-sm">Carregando planos</span>
            </div>
          ) : planos.length === 0 ? (
            <p className="mt-12 text-sm text-[#5B6878]">
              Os planos não carregaram.{' '}
              <Link href="/signup" className="text-[#004aad] underline">
                Criar conta
              </Link>{' '}
              e ver os valores na tela de assinatura.
            </p>
          ) : (
            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {planos.map((p, i) => (
                <PlanoCard key={p.id} plano={p} atraso={(i % 3) * 70} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Fechamento ───────────────────────────────────────────────── */}
      <section className="border-t border-[#E3E8F0]" style={{ background: '#0F1621' }}>
        <div className="mx-auto max-w-6xl px-5 py-20 text-center">
          <h2 className="lp-display mx-auto max-w-2xl text-[1.875rem] text-white sm:text-[2.25rem]">
            Descubra quanto a sua agência ganhou de verdade no mês passado.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed" style={{ color: 'rgba(230,237,247,0.7)' }}>
            Importe as vendas, conecte o banco e feche um mês. Se o número não te
            surpreender, cancele.
          </p>
          <Link
            href="/signup"
            className="mt-9 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-semibold text-[#0F1621] transition-transform hover:scale-[1.015] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Começar grátis por 14 dias <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#E3E8F0] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Logo variant="sidebar" href="/" />
          <p className="text-xs text-[#5B6878]">
            Entur OS Fin · Sistema financeiro para agências de viagem
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Revela os blocos conforme entram na tela.
 *
 * `IntersectionObserver` em vez de escutar o scroll: o navegador avisa
 * quando o elemento aparece, sem rodar código a cada pixel rolado. Só marca
 * uma vez — bloco que reaparece não anima de novo, porque repetir a
 * animação a cada subida e descida cansa.
 */
function useRevelacaoNoScroll() {
  const observador = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const raiz = document.querySelector<HTMLElement>('.lp');
    if (!raiz) return;

    const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Sem observador, ou com menos movimento pedido, a animação nem começa:
    // o container fica sem `data-anima` e o conteúdo permanece visível, que
    // é o estado padrão do CSS.
    if (menosMovimento || !('IntersectionObserver' in window)) return;

    raiz.setAttribute('data-anima', '1');
    const alvos = Array.from(document.querySelectorAll<HTMLElement>('.lp-reveal'));

    observador.current = new IntersectionObserver(
      entradas => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute('data-visivel', '1');
          observador.current?.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.1 },
    );

    alvos.forEach(el => observador.current?.observe(el));
    return () => {
      observador.current?.disconnect();
      raiz.removeAttribute('data-anima');
    };
  }, []);
}

function PlanoCard({ plano, atraso }: { plano: Plano; atraso: number }) {
  const itens = Array.isArray(plano.features) ? plano.features : [];
  const destaque = plano.destaque;

  return (
    <article
      className={`lp-cartao lp-reveal flex flex-col p-6 ${destaque ? 'border-[#004aad] shadow-[0_0_0_1px_#004aad]' : ''}`}
      style={{ transitionDelay: `${atraso}ms` }}
    >
      {destaque ? (
        <span className="lp-eyebrow mb-3 inline-block" style={{ color: '#004aad' }}>
          Mais escolhido
        </span>
      ) : null}
      <h3 className="text-[17px] font-semibold text-[#1A1A1A]">{plano.nome}</h3>
      {plano.descricao ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-[#5B6878]">{plano.descricao}</p>
      ) : null}

      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="lp-num text-[32px] leading-none text-[#1A1A1A]">
          R$ {Number(plano.preco_mensal ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
        </span>
        <span className="text-[13px] text-[#5B6878]">/mês</span>
      </p>

      {itens.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2.5">
          {itens.map(f => (
            <li key={f} className="flex items-start gap-2 text-[13px] leading-relaxed text-[#475569]">
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#047857]" />
              {f}
            </li>
          ))}
        </ul>
      ) : null}

      <Link
        href="/signup"
        className={`mt-7 inline-flex items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
          destaque
            ? 'bg-[#004aad] text-white hover:bg-[#003B8A]'
            : 'border border-[#E3E8F0] text-[#475569] hover:border-[#C9D3E3] hover:text-[#1A1A1A]'
        }`}
      >
        Começar com {plano.nome}
      </Link>
    </article>
  );
}
