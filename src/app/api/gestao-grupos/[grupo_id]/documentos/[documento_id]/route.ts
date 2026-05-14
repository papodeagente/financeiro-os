import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import {
  DOCUMENTO_TIPO_LABEL,
  DOCUMENTO_STATUS_LABEL,
  registrarEvento,
  type DocumentoData,
  type DocumentoTipo,
  type DocumentoStatus,
} from '@/lib/gestao-grupos';

const TIPOS_VALIDOS: DocumentoTipo[] = Object.keys(DOCUMENTO_TIPO_LABEL) as DocumentoTipo[];
const STATUS_VALIDOS: DocumentoStatus[] = Object.keys(DOCUMENTO_STATUS_LABEL) as DocumentoStatus[];

// PUT /api/gestao-grupos/[grupo_id]/documentos/[documento_id]
// Atualiza status, anexo, observações, motivo reprovação.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; documento_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, documento_id } = await params;
  const body = await req.json();

  const { rows } = await pool.query(
    `SELECT id, passageiro_id, tipo, status, data FROM grupo_documentos
      WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [documento_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 });
  const atual = rows[0];
  const dataAtual = atual.data as DocumentoData;

  const tipoNovo: DocumentoTipo = TIPOS_VALIDOS.includes(body.tipo) ? body.tipo : atual.tipo;
  const statusNovo: DocumentoStatus = STATUS_VALIDOS.includes(body.status) ? body.status : atual.status;

  // Quando o anexo é atualizado (url muda), registra data_envio
  const novoUrl = body.url !== undefined ? body.url : dataAtual.url;
  const dataEnvio = (novoUrl && novoUrl !== dataAtual.url)
    ? new Date().toISOString()
    : dataAtual.data_envio;

  // Quando status vai pra aprovado, registra data_aprovacao
  const dataAprovacao = statusNovo === 'aprovado' && atual.status !== 'aprovado'
    ? new Date().toISOString()
    : dataAtual.data_aprovacao;

  const dataNova: DocumentoData = {
    ...dataAtual,
    nome_personalizado: body.nome_personalizado ?? dataAtual.nome_personalizado,
    url: novoUrl,
    nome_arquivo: body.nome_arquivo ?? dataAtual.nome_arquivo,
    tamanho_bytes: body.tamanho_bytes !== undefined ? body.tamanho_bytes : dataAtual.tamanho_bytes,
    extensao: body.extensao !== undefined ? body.extensao : dataAtual.extensao,
    data_vencimento: body.data_vencimento ?? dataAtual.data_vencimento,
    observacoes: body.observacoes ?? dataAtual.observacoes,
    motivo_reprovacao: body.motivo_reprovacao ?? dataAtual.motivo_reprovacao,
    data_envio: dataEnvio,
    data_aprovacao: dataAprovacao,
    aprovador: body.aprovador ?? dataAtual.aprovador,
  };

  await pool.query(
    `UPDATE grupo_documentos SET tipo = $1, status = $2, data = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5`,
    [tipoNovo, statusNovo, JSON.stringify(dataNova), documento_id, tenantId],
  );

  // Eventos específicos pra mudanças de status críticas
  if (statusNovo === 'aprovado' && atual.status !== 'aprovado') {
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'documento_aprovado',
      descricao: `${DOCUMENTO_TIPO_LABEL[tipoNovo]} aprovado`,
      passageiro_id: atual.passageiro_id, entidade_id: documento_id, entidade_label: DOCUMENTO_TIPO_LABEL[tipoNovo],
    });
  } else if (statusNovo === 'reprovado' && atual.status !== 'reprovado') {
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'documento_reprovado',
      descricao: `${DOCUMENTO_TIPO_LABEL[tipoNovo]} reprovado${dataNova.motivo_reprovacao ? ': ' + dataNova.motivo_reprovacao : ''}`,
      passageiro_id: atual.passageiro_id, entidade_id: documento_id, entidade_label: DOCUMENTO_TIPO_LABEL[tipoNovo],
    });
  } else if (statusNovo !== atual.status || tipoNovo !== atual.tipo) {
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'documento_atualizado',
      descricao: `${DOCUMENTO_TIPO_LABEL[tipoNovo]}: ${atual.status} → ${statusNovo}`,
      passageiro_id: atual.passageiro_id, entidade_id: documento_id,
    });
  }

  return NextResponse.json({ id: documento_id, grupo_id, passageiro_id: atual.passageiro_id, tipo: tipoNovo, status: statusNovo, ...dataNova });
}

// DELETE /api/gestao-grupos/[grupo_id]/documentos/[documento_id]
// Remove o registro de documento. Arquivo no volume não é deletado.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; documento_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, documento_id } = await params;

  await pool.query(
    `DELETE FROM grupo_documentos WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [documento_id, grupo_id, tenantId],
  );
  return NextResponse.json({ ok: true });
}
