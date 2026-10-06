"""
Troca hex de INTERFACE (paleta do Tailwind digitada à mão, o dourado antigo)
pelos tokens --fin-*. Dado e conteúdo ficam: tema de proposta, categoria de
funil, bandeira de cartão, paleta do mapa mental, moldura de celular.

Uso:  python3 scripts/design/tokenizar-hex.py [--gravar]
"""
import os, re, sys, collections
RAIZ = os.path.join(os.path.dirname(__file__), '..', '..', 'src')
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
_spec = importlib.util.spec_from_file_location('cores', os.path.join(os.path.dirname(__file__), 'tokenizar-cores.py'))
_cores = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_cores)
EXCLUIR = _cores.EXCLUIR + [
    'lib/', 'app/api/', 'components/funis/', 'app/planejamento/funis/[id]/FunilEditor.tsx',
    'components/propostas/PhoneFrame.tsx', 'components/propostas/PropostaEditor.tsx',
    'app/grupo/[id]/gestao/HistoricoTab.tsx',   # categorias: tratadas à mão como séries
]
# hex -> (token, mistura%) ; mistura None = token puro
DIC = {}
def reg(tok, *hs, mix=None):
    for h in hs: DIC[h] = (tok, mix)
reg('--fin-text', '#0f172a', '#1a1a1a', '#111827', '#1e293b', '#0a0a14')
reg('--fin-text-2', '#475569', '#4b5563', '#374151', '#334155')
reg('--fin-text-3', '#64748b', '#6b7280', '#94a3b8', '#9ca3af')
reg('--fin-border', '#e2e8f0', '#e5e7eb', '#e4e7ef', '#3a3a5e')
reg('--fin-border-strong', '#cbd5e1', '#d1d5db')
reg('--fin-surface-2', '#f1f5f9', '#f3f4f6', '#f8fafc', '#f9fafb')
reg('--fin-surface', '#ffffff', '#fff', '#1a1a2e')
reg('--fin-positive', '#22c55e', '#10b981', '#16a34a', '#059669', '#047857', '#065f46', '#15803d', '#14b8a6')
reg('--fin-positive-soft', '#dcfce7', '#ecfdf5', '#d1fae5', '#f0fdf4')
reg('--fin-positive', '#a7f3d0', '#bbf7d0', '#6ee7b7', mix=40)
reg('--fin-negative', '#ef4444', '#dc2626')
reg('--fin-negative-text', '#b91c1c', '#991b1b', '#b42318')
reg('--fin-negative-soft', '#fee2e2', '#fef2f2')
reg('--fin-negative', '#fca5a5', '#fecaca', mix=40)
reg('--fin-warning', '#f59e0b', '#d97706', '#f97316', '#ea580c')
reg('--fin-warning-text', '#92400e', '#b45309')
reg('--fin-warning-soft', '#fef3c7', '#fffbeb', '#ffedd5')
reg('--fin-warning', '#fde68a', '#fcd34d', mix=40)
reg('--fin-accent', '#2563eb', '#3b82f6', '#004aad', '#1d4ed8', '#4f46e5', '#6366f1', '#d4a853', '#e0b864')
reg('--fin-accent-hover', '#c49a48', '#003b8a', '#1e40af')
reg('--fin-accent-soft', '#dbeafe', '#eff6ff', '#e8eff9')
reg('--fin-accent', '#bfdbfe', '#60a5fa', '#93c5fd', mix=40)
reg('--fin-violet', '#8b5cf6', '#7c3aed', '#6d28d9', '#ec4899', '#a855f7')
reg('--fin-violet-soft', '#ede9fe', '#f5f3ff', '#fce7f3')
reg('--fin-info', '#06b6d4', '#0891b2', '#0ea5e9')
reg('--fin-info-soft', '#cffafe', '#ecfeff', '#e0f2fe')

def css(h):
    tok, mix = DIC[h]
    return f'var({tok})' if mix is None else f'color-mix(in srgb, var({tok}) {mix}%, transparent)'

def tw(h):
    tok, mix = DIC[h]
    return f'[var({tok})]' if mix is None else f'[var({tok})]/{mix}'

HEX = r'#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])'
EM_CLASSE = re.compile(r'((?:[a-z\-]+:)*)([a-z\-]+)-\[(' + HEX + r')\]')
EM_STRING = re.compile(r"""(['"])(""" + HEX + r""")\1""")
EM_ATRIB = re.compile(r'(\b(?:fill|stroke|stopColor|color|bgColor|cor)=)(["\'])(' + HEX + r')\2')

def processar(p, gravar, cont, faltou):
    s = open(p, encoding='utf-8').read()
    def classe(m):
        pre, util, h = m.group(1), m.group(2), m.group(3).lower()
        if 'dark:' in pre:
            cont['dark'] += 1; return ''
        if h not in DIC: faltou[h] += 1; return m.group(0)
        cont['classe'] += 1; return f'{pre}{util}-{tw(h)}'
    def string(m):
        h = m.group(2).lower()
        if h not in DIC: faltou[h] += 1; return m.group(0)
        cont['string'] += 1; return f"{m.group(1)}{css(h)}{m.group(1)}"
    def atrib(m):
        h = m.group(3).lower()
        if h not in DIC: faltou[h] += 1; return m.group(0)
        cont['atrib'] += 1; return f'{m.group(1)}"{css(h)}"'
    out = EM_CLASSE.sub(classe, s)
    out = EM_ATRIB.sub(atrib, out)
    out = EM_STRING.sub(string, out)
    if gravar and out != s: open(p, 'w', encoding='utf-8').write(out)
    return out != s

def main():
    gravar = '--gravar' in sys.argv
    cont = collections.Counter(); faltou = collections.Counter(); n = 0
    for raiz, _, fs in os.walk(RAIZ):
        for f in fs:
            if not f.endswith('.tsx'): continue
            p = os.path.join(raiz, f); rel = os.path.relpath(p, RAIZ).replace(os.sep, '/')
            if any(rel.startswith(e) or rel == e for e in EXCLUIR): continue
            if processar(p, gravar, cont, faltou): n += 1
    print(('GRAVADO' if gravar else 'RELATÓRIO'), dict(cont), 'arquivos:', n)
    print('sem mapeamento:', faltou.most_common(20))

if __name__ == '__main__':
    main()
