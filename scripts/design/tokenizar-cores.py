"""
Troca classes de cor crua do Tailwind (bg-blue-500, text-gray-600...) pelos
tokens semânticos --fin-*, que são a única fonte de cor do sistema.

Uso:  python3 scripts/design/tokenizar-cores.py [--gravar]
Sem --gravar, só relata. Conteúdo que não é interface fica de fora (ver EXCLUIR).
"""
import os, re, sys, collections

RAIZ = os.path.join(os.path.dirname(__file__), '..', '..', 'src')
EXCLUIR = [
    'components/landing/',            # landing pública, identidade própria
    'components/propostas/preview/',  # documento da proposta (cores do modelo)
    'components/propostas/blocks/',   # blocos do documento dentro do editor
    'components/propostas/PdfExportModal.tsx',
    'app/p/',                         # proposta pública
    'app/preview-iframe/',
    'app/mapas-mentais/',             # mapa público: cores escolhidas pelo usuário
    'app/planejamento/mapas-mentais/[id]/MapaMentalEditor.tsx',  # paleta de cores do editor
    'app/planejamento/fluxogramas/[id]/',  # nós BPMN
    'components/funis/FunilNode.tsx', # cor por tipo de nó do funil
    'components/icons/',
    'components/Logo.tsx',
]
NEUTRO = {'slate', 'gray', 'zinc', 'neutral', 'stone'}
FAMILIA = {}
for c in ('red', 'rose'): FAMILIA[c] = 'neg'
for c in ('green', 'emerald', 'lime', 'teal'): FAMILIA[c] = 'pos'
for c in ('amber', 'yellow', 'orange'): FAMILIA[c] = 'warn'
for c in ('blue', 'indigo', 'sky'): FAMILIA[c] = 'acc'
FAMILIA['cyan'] = 'info'
for c in ('violet', 'purple', 'fuchsia', 'pink'): FAMILIA[c] = 'vio'

COR = {  # (forte, suave, texto)
    'neg': ('--fin-negative', '--fin-negative-soft', '--fin-negative-text'),
    'pos': ('--fin-positive', '--fin-positive-soft', '--fin-positive'),
    'warn': ('--fin-warning', '--fin-warning-soft', '--fin-warning-text'),
    'acc': ('--fin-accent', '--fin-accent-soft', '--fin-accent'),
    'info': ('--fin-info', '--fin-info-soft', '--fin-info'),
    'vio': ('--fin-violet', '--fin-violet-soft', '--fin-violet'),
}
CORES = '|'.join(sorted(NEUTRO | set(FAMILIA) | {'white', 'black'}, key=len, reverse=True))
CLASSE = re.compile(
    r'(?<![\w\-\[/])((?:[a-z0-9\-\[\]&:*>_]+:)*)'
    r'(bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|from|via|to|fill|stroke|divide|placeholder|decoration|shadow|accent|caret)'
    r'-(' + CORES + r')(?:-(\d{2,3}))?(?:/(\d{1,3}))?(?![\w\-\[])'
)

def v(tok, alfa=None):
    return f'[var({tok})]' + (f'/{alfa}' if alfa else '')

def mapear(util, cor, tom, alfa):
    """Devolve o sufixo de cor (ex.: '[var(--fin-text)]') ou None para remover a classe."""
    t = int(tom) if tom else None
    a = int(alfa) if alfa else None
    base = util.split('-')[0] if util.startswith('border') else util
    if util == 'shadow':
        return None                      # sombra colorida: fora da direção visual
    if cor == 'white':
        if base == 'text': return 'white'  # decidido pelo contexto (ver tratar_texto_branco)
        if base in ('bg', 'from', 'via', 'to', 'fill'): return v('--fin-surface', alfa)
        if base in ('border', 'ring', 'divide', 'outline'): return v('--fin-surface', alfa)
        return v('--fin-surface', alfa)
    if cor == 'black':
        if base == 'bg' and a is not None: return 'black' + (f'/{alfa}' if alfa else '')  # véu de modal
        if base == 'text': return v('--fin-text', alfa)
        return v('--fin-text', alfa)
    if cor in NEUTRO:
        t = t or 500
        if base in ('text', 'placeholder', 'decoration', 'caret'):
            if t >= 800: return v('--fin-text', alfa)
            if t >= 600: return v('--fin-text-2', alfa)
            if t >= 300: return v('--fin-text-3', alfa)
            return v('--fin-text-on-fill', alfa)
        if base in ('bg', 'from', 'via', 'to'):
            if t <= 100: return v('--fin-surface-2', alfa)
            if t <= 200: return v('--fin-surface-sunken', alfa)
            if t <= 400: return v('--fin-border-strong', alfa)
            if t <= 600: return v('--fin-text-3', alfa)
            return v('--fin-text', alfa)
        if base in ('border', 'divide', 'ring', 'outline', 'ring-offset'):
            return v('--fin-border' if t <= 200 else '--fin-border-strong', alfa)
        if base in ('fill', 'stroke'):
            if t <= 300: return v('--fin-border-strong', alfa)
            return v('--fin-text-3' if t <= 500 else '--fin-text-2', alfa)
        if base == 'accent': return v('--fin-accent', alfa)
        return v('--fin-text-3', alfa)
    fam = FAMILIA[cor]
    forte, suave, texto = COR[fam]
    t = t or 500
    if base in ('text', 'placeholder', 'decoration', 'caret'):
        if t <= 200: return v('--fin-text-on-fill', alfa)
        return v(texto, alfa)
    if base in ('bg', 'from', 'via', 'to'):
        if t <= 200 or (a is not None and a <= 20): return v(suave)
        if fam == 'acc' and t >= 700: return v('--fin-accent-hover', alfa)
        return v(forte, alfa)
    if base in ('border', 'divide', 'outline', 'ring', 'ring-offset'):
        if a is not None: return v(forte, alfa)
        if t <= 300: return v(forte, '30')
        return v(forte)
    if base in ('fill', 'stroke'):
        return v(suave if t <= 200 else forte, alfa)
    if base == 'accent': return v(forte, alfa)
    return v(forte, alfa)

PREENCHE = re.compile(r'bg-\[var\(--fin-(accent|accent-hover|positive|negative|warning|info|violet|text)\)\](?!/)')

def tratar_string(s, cont, naomap):
    def troca(m):
        prefixo, util, cor, tom, alfa = m.groups()
        if 'dark:' in prefixo:
            cont['dark'] += 1
            return ''                    # o tema escuro vem dos tokens
        novo = mapear(util, cor, tom, alfa)
        if novo is None:
            cont['removida'] += 1
            return ''
        if novo == 'white' or novo.startswith('black'):
            return m.group(0)
        cont['trocada'] += 1
        return f'{prefixo}{util}-{novo}'
    s2 = CLASSE.sub(troca, s)
    # Texto branco sobre preenchimento de token vira "texto sobre preenchimento":
    # no tema escuro o preenchimento clareia e o texto precisa escurecer junto.
    if PREENCHE.search(s2):
        s3 = re.sub(r'(?<![\w\-\[/])((?:[a-z\-]+:)*)text-white(?![\w\-\[])', lambda m: f'{m.group(1)}text-[var(--fin-text-on-fill)]', s2)
        if s3 != s2: cont['branco'] += 1
        s2 = s3
    return re.sub(r'[ ]{2,}', ' ', s2) if s2 != s else s2

# Só mexe dentro de literais de string/template (classes), nunca em código.
LITERAL = re.compile(r"""('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)""")

def processar(caminho, gravar):
    src = open(caminho, encoding='utf-8').read()
    cont = collections.Counter(); naomap = []
    def lit(m):
        t = m.group(0)
        if not CLASSE.search(t): return t
        q = t[0]; corpo = t[1:-1]
        novo = tratar_string(corpo, cont, naomap)
        novo = novo.replace(' ' + q, q) if False else novo
        return q + (novo.strip() if q != '`' and novo != corpo and corpo == corpo.strip() else novo) + q
    out = LITERAL.sub(lit, src)
    # className="..." em JSX entra pelo LITERAL acima (aspas duplas).
    if gravar and out != src:
        open(caminho, 'w', encoding='utf-8').write(out)
    return cont, out != src

def main():
    gravar = '--gravar' in sys.argv
    total = collections.Counter(); arquivos = 0; mudados = []
    for raiz, _, fs in os.walk(RAIZ):
        for f in fs:
            if not f.endswith('.tsx') and not f.endswith('.ts'): continue
            p = os.path.join(raiz, f)
            rel = os.path.relpath(p, RAIZ).replace(os.sep, '/')
            if any(rel.startswith(e) or rel == e for e in EXCLUIR): continue
            cont, mudou = processar(p, gravar)
            if mudou:
                arquivos += 1; mudados.append((sum(cont.values()), rel)); total.update(cont)
    print(('GRAVADO' if gravar else 'RELATÓRIO'), dict(total), 'arquivos:', arquivos)
    for n, rel in sorted(mudados, reverse=True)[:15]: print(f'  {n:4d}  {rel}')

if __name__ == '__main__':
    main()
