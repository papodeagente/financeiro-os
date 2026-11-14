'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, UserPlus } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { Button } from '@/components/ui/button';
import { createFornecedorCRM, type FornecedorCRM } from '@/lib/crm-types';
import { saveEntity } from '@/lib/crm-storage';
import { formatarDocumento } from '@/lib/leitura-documento';
import { toast } from '@/lib/toast';

import {
  escolherCategoriaSugerida, escolherNaDivergencia, ligarFornecedorCadastrado, ROTULO_DO_CAMPO,
} from './leitura';
import type { FormState } from './tipos';

/**
 * O que a leitura do documento pede de atenção, dentro do bloco "Lido de...":
 * o código do boleto conferido (ou não), as divergências para escolher, o
 * fornecedor que não está no cadastro, os campos que ficaram como estavam e
 * as outras categorias já usadas para o fornecedor.
 *
 * Tudo aqui é escolha da pessoa, com clique. Cadastrar o fornecedor é a
 * única gravação, e só pelo botão.
 */

type Props = {
  form: FormState;
  onForm: (atualiza: (f: FormState) => FormState) => void;
  onCategoriaChange: (categoriaId: string) => void;
};

const AVISO_LINHA = 'A linha digitável lida não confere. O valor não foi preenchido: confira no papel.';

function Linha({ tom, children }: { tom: 'positivo' | 'aviso'; children: React.ReactNode }) {
  const Icone = tom === 'positivo' ? CheckCircle2 : AlertTriangle;
  return (
    <p className="flex items-start gap-2 fin-t-caption text-[var(--fin-text-2)]">
      <Icone
        aria-hidden
        className={tom === 'positivo'
          ? 'mt-px size-4 shrink-0 text-[var(--fin-positive)]'
          : 'mt-px size-4 shrink-0 text-[var(--fin-warning-text)]'}
      />
      <span>{children}</span>
    </p>
  );
}

export function DetalhesDaLeitura({ form, onForm, onCategoriaChange }: Props) {
  const [cadastrando, setCadastrando] = React.useState(false);
  const leitura = form.leitura;
  if (!leitura) return null;
  const { leitura: lido, sugestoes } = leitura.resposta;
  const divergencias = lido.divergencias.filter((d) => !leitura.resolvidas.includes(d.campo));
  const outrasCategorias = sugestoes.categorias.filter((c) => c.id !== form.categoria_id);
  const avisos = lido.avisos.filter((a) => a !== AVISO_LINHA);

  async function cadastrarFornecedor() {
    if (cadastrando || !leitura) return;
    const nome = lido.fornecedor_nome.trim();
    if (!nome) return;
    setCadastrando(true);
    try {
      const novo: FornecedorCRM = {
        ...createFornecedorCRM(),
        nome_fantasia: nome,
        razao_social: nome,
        cnpj: lido.fornecedor_cnpj ? formatarDocumento(lido.fornecedor_cnpj) : '',
      };
      const salvo = await saveEntity<FornecedorCRM>('fornecedores-crm', novo);
      onForm((f) => ligarFornecedorCadastrado(f, { id: salvo.id, nome }));
      toast.success('Fornecedor cadastrado', nome);
    } catch (e) {
      toast.error('Não foi possível cadastrar o fornecedor', e instanceof Error ? e.message : '');
    } finally {
      setCadastrando(false);
    }
  }

  const linhas: React.ReactNode[] = [];

  if (lido.boleto?.confere) {
    const pelo = [
      lido.valor_origem === 'boleto' ? 'o valor' : null,
      lido.vencimento_origem === 'boleto' ? 'o vencimento' : null,
    ].filter(Boolean);
    linhas.push(
      <Linha key="boleto" tom="positivo">
        Código do boleto conferido{pelo.length ? `: ${pelo.join(' e ')} vêm dele` : ''}.
      </Linha>,
    );
  } else if (lido.boleto) {
    linhas.push(
      <Linha key="boleto" tom="aviso">
        {lido.boleto.mensagem} O valor ficou em branco: corrija a linha digitável em Pagamento ou digite o valor.
      </Linha>,
    );
  }

  for (const a of avisos) linhas.push(<Linha key={a} tom="aviso">{a}</Linha>);

  if (leitura.mantidos.length > 0) {
    linhas.push(
      <p key="mantidos" className="fin-t-caption text-[var(--fin-text-3)]">
        Ficaram como você tinha preenchido: {leitura.mantidos.map((c) => ROTULO_DO_CAMPO[c]).join(', ')}.
      </p>,
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--fin-border)] pt-3">
      {linhas.length > 0 ? <div className="flex flex-col gap-1.5">{linhas}</div> : null}

      {divergencias.map((d) => (
        <Callout
          key={d.campo}
          tom="aviso"
          titulo={d.campo === 'valor' ? 'O valor não bate' : 'O vencimento não bate'}
          acao={{ rotulo: `Usar ${d.no_boleto}, do boleto`, onClick: () => onForm((f) => escolherNaDivergencia(f, d, 'boleto')) }}
          acaoSecundaria={{ rotulo: `Usar ${d.no_documento}, do documento`, onClick: () => onForm((f) => escolherNaDivergencia(f, d, 'documento')) }}
        >
          {d.mensagem} O campo ficou em branco até você escolher.
        </Callout>
      ))}

      {sugestoes.sugerir_criar && lido.fornecedor_nome ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="fin-t-caption text-[var(--fin-text-2)]">
            <span className="fin-t-body-strong text-[var(--fin-text)]">{lido.fornecedor_nome}</span>
            {lido.fornecedor_cnpj ? ` (${formatarDocumento(lido.fornecedor_cnpj)})` : ''} ainda não está no cadastro de fornecedores.
          </p>
          <Button type="button" variant="outline" size="sm" className="self-start sm:self-center" disabled={cadastrando} onClick={cadastrarFornecedor}>
            <UserPlus className="size-3.5" aria-hidden />
            {cadastrando ? 'Cadastrando…' : 'Cadastrar fornecedor'}
          </Button>
        </div>
      ) : null}

      {outrasCategorias.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            {form.categoria_id ? 'Outras categorias já usadas para este fornecedor:' : 'Categorias já usadas para este fornecedor:'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {outrasCategorias.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  onCategoriaChange(c.id);
                  onForm((f) => escolherCategoriaSugerida(f, c));
                }}
              >
                {c.codigo ? `${c.codigo} · ` : ''}{c.nome}
                <span className="text-[var(--fin-text-3)] tabular-nums">{c.vezes}×</span>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DetalhesDaLeitura;
