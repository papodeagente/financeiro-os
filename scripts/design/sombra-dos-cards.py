"""
Dá aos cartões escritos à mão o mesmo "sopro" de sombra do Card do sistema
(--fin-e-card). Só entra string de classe que tem cara de cartão: raio de
card + fundo de superfície + borda, e que ainda não declara sombra.

Uso:  python3 scripts/design/sombra-dos-cards.py [--gravar]
"""
import os, re, sys, importlib.util
RAIZ = os.path.join(os.path.dirname(__file__), '..', '..', 'src')
_s = importlib.util.spec_from_file_location('c', os.path.join(os.path.dirname(__file__), 'tokenizar-cores.py'))
_c = importlib.util.module_from_spec(_s); _s.loader.exec_module(_c)
RAIO = re.compile(r'(?<![\w-])rounded-(?:\[var\(--(?:fin-r-lg|t-card-radius|lg-radius-lg|lg-radius-xl)\)\]|xl|2xl|\[1[2-6]px\])(?![\w-])')
FUNDO = re.compile(r'(?<![\w:-])bg-\[var\(--(?:fin-surface|t-surface|lg-surface-solid|lg-material-regular)\)\](?![\w/])')
BORDA = re.compile(r'(?<![\w:-])border(?: |$|-\[var\(--(?:fin-border|t-border|lg-border-base)\)\])')
LITERAL = re.compile(r"""('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)""")
def main():
    gravar = '--gravar' in sys.argv; n = 0; arqs = 0
    for raiz, _, fs in os.walk(RAIZ):
        for f in fs:
            if not f.endswith('.tsx'): continue
            p = os.path.join(raiz, f); rel = os.path.relpath(p, RAIZ).replace(os.sep, '/')
            if any(rel.startswith(e) or rel == e for e in _c.EXCLUIR): continue
            src = open(p, encoding='utf-8').read(); cont = [0]
            def lit(m):
                t = m.group(0); corpo = t[1:-1]
                if 'shadow' in corpo or not (RAIO.search(corpo) and FUNDO.search(corpo) and BORDA.search(corpo)): return t
                if 'fixed' in corpo.split() or 'absolute' in corpo.split(): return t   # flutuante: tem sombra própria
                cont[0] += 1
                return t[0] + corpo.rstrip() + ' shadow-[var(--fin-e-card)]' + t[-1]
            out = LITERAL.sub(lit, src)
            if out != src:
                arqs += 1; n += cont[0]
                if gravar: open(p, 'w', encoding='utf-8').write(out)
    print(('GRAVADO' if gravar else 'RELATÓRIO'), 'cartões:', n, 'arquivos:', arqs)
if __name__ == '__main__': main()
