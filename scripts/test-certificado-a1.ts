/**
 * Testes da leitura do certificado A1 (src/lib/certificado-a1.ts).
 *
 * O certificado de teste é gerado na hora com a estrutura da ICP-Brasil
 * (otherName com os OIDs 2.16.76.1.3.x e CN "RAZAO:CNPJ"). Não existe .pfx
 * real no repositório e nunca vai existir.
 *
 * Roda com: node --experimental-strip-types scripts/test-certificado-a1.ts
 */
import { lerCertificadoA1, ErroCertificado } from '../src/lib/certificado-a1.ts';
import { gerarPfxDeTeste } from './pfx-de-teste.ts';

let falhas = 0;
let total = 0;

function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

function lanca(fn: () => unknown, motivo: string, label: string) {
  total++;
  try {
    fn();
    falhas++;
    console.log(`FAIL  ${label}\n        esperado erro '${motivo}', não lançou`);
  } catch (e) {
    const ok = e instanceof ErroCertificado && e.motivo === motivo;
    if (!ok) {
      falhas++;
      console.log(`FAIL  ${label}\n        esperado motivo '${motivo}', obtido: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    } else {
      console.log(`PASS  ${label}`);
    }
  }
}

const HOJE = new Date('2026-09-14T12:00:00Z');

// ══════════════════════════════════════════════════════════════════════
console.log('--- o certificado diz quem é a empresa ---');
{
  const { bytes, senha } = gerarPfxDeTeste({
    cnpj: '41322617000100',
    razao_social: 'ESCOLA DE NEGOCIOS DO TURISMO',
    responsavel_nome: 'BRUNO BARBOSA DA SILVA',
    responsavel_cpf: '98765432100',
  });
  const d = lerCertificadoA1(bytes, senha, HOJE);
  eq(d.cnpj, '41322617000100', 'CNPJ vem do OID da ICP-Brasil');
  eq(d.razao_social, 'ESCOLA DE NEGOCIOS DO TURISMO', 'razão social vem do CN, sem o CNPJ colado');
  eq(d.responsavel_nome, 'BRUNO BARBOSA DA SILVA', 'nome do responsável');
  eq(d.responsavel_cpf, '98765432100', 'CPF do responsável sai da posição certa do OID .4');
  eq(d.emissor, 'AC TESTE ICP-BRASIL', 'autoridade certificadora');
  eq(d.validade_inicio, '2026-01-01', 'início da validade');
  eq(d.validade_fim, '2027-01-01', 'fim da validade');
  eq(d.vencido, false, 'não está vencido em 14/09/2026');
  eq(d.dias_para_vencer > 100, true, 'ainda tem mais de 100 dias');
  eq(/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/.test(d.impressao_digital), true, 'impressão digital SHA-1 formatada');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- sem os OIDs, o CN ainda responde ---');
{
  const { bytes, senha } = gerarPfxDeTeste({ semOids: true, cnpj: '11222333000181' });
  const d = lerCertificadoA1(bytes, senha, HOJE);
  eq(d.cnpj, '11222333000181', 'CNPJ sai do CN como segunda fonte');
  eq(d.responsavel_nome, '', 'sem OID não inventa responsável');
  eq(d.responsavel_cpf, '', 'nem CPF');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o que impede de usar ---');
{
  const { bytes } = gerarPfxDeTeste({ senha: 'certa' });
  lanca(() => lerCertificadoA1(bytes, 'errada', HOJE), 'senha', 'senha errada é dita como senha errada');
}
{
  const lixo = new TextEncoder().encode('isto nao e um pfx, e um texto qualquer');
  lanca(() => lerCertificadoA1(lixo, 'x', HOJE), 'formato', 'arquivo que não é PKCS#12 é dito como formato');
}
{
  lanca(() => lerCertificadoA1(new Uint8Array(0), 'x', HOJE), 'formato', 'arquivo vazio é formato');
}
{
  const { bytes, senha } = gerarPfxDeTeste({ pessoaFisica: true });
  lanca(() => lerCertificadoA1(bytes, senha, HOJE), 'sem_cnpj', 'e-CPF não serve para nota da empresa');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- validade ---');
{
  const { bytes, senha } = gerarPfxDeTeste({ inicio: new Date('2024-01-01T00:00:00Z'), anos: 1 });
  const d = lerCertificadoA1(bytes, senha, HOJE);
  eq(d.vencido, true, 'certificado de 2024 está vencido em 2026');
  eq(d.dias_para_vencer < 0, true, 'dias negativos');
  eq(d.validade_fim, '2024-12-31', 'a data de vencimento continua legível');
}
{
  // Vence daqui a 10 dias: não está vencido, mas a tela precisa avisar.
  const inicio = new Date(HOJE.getTime() - (365 - 10) * 86_400_000);
  const { bytes, senha } = gerarPfxDeTeste({ inicio, anos: 1 });
  const d = lerCertificadoA1(bytes, senha, HOJE);
  eq(d.vencido, false, 'a 10 dias do fim ainda vale');
  eq(d.dias_para_vencer >= 9 && d.dias_para_vencer <= 10, true, 'e a contagem de dias bate');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes do certificado A1 passaram`);
if (falhas > 0) process.exit(1);
