"""
Texto sobre preenchimento de destaque vira --fin-text-on-fill.

Dois defeitos com a mesma causa: botão com fundo de destaque e texto
escrito à mão. 'text-white' perde contraste no tema escuro (o azul clareia
e o branco some, 2,8:1); 'text-[var(--t-text)]' sobrou do acento dourado
antigo e hoje é texto escuro sobre azul. O par certo é preenchimento +
--fin-text-on-fill, que muda junto com o tema.

Uso:  python3 scripts/design/texto-sobre-preenchimento.py [--gravar]
"""
import os, re, sys, importlib.util
RAIZ = os.path.join(os.path.dirname(__file__), '..', '..', 'src')
_s = importlib.util.spec_from_file_location('c', os.path.join(os.path.dirname(__file__), 'tokenizar-cores.py'))
_c = importlib.util.module_from_spec(_s); _s.loader.exec_module(_c)
FILL = r'bg-\[var\(--(?:t-green|t-accent|t-primary|t-blue|lg-accent|fin-accent|fin-accent-hover|fin-positive|fin-negative|fin-violet|fin-info)\)\](?!/)'
TEXTO = r'text-(?:white|\[var\(--(?:t-text|fin-text|lg-text|ink-text)\)\])'
LIT = re.compile(r"""("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)""")
def corrigir(corpo, cont):
    novo = corpo
    for pre in ('', 'hover:', 'group-hover:', 'data-\\[state=active\\]:', 'aria-selected:'):
        if re.search(r'(?<![\w:\[-])' + pre + FILL, novo):
            antes = novo
            novo = re.sub(r'(?<![\w:\[-])(' + pre + r')' + TEXTO + r'(?![\w\-\[])', lambda m: m.group(1) + 'text-[var(--fin-text-on-fill)]', novo)
            if novo != antes: cont[0] += 1
    return novo
def main():
    gravar = '--gravar' in sys.argv; tot = [0]; arqs = 0
    for raiz, _, fs in os.walk(RAIZ):
        for f in fs:
            if not f.endswith('.tsx'): continue
            p = os.path.join(raiz, f); rel = os.path.relpath(p, RAIZ).replace(os.sep, '/')
            if any(rel.startswith(e) or rel == e for e in _c.EXCLUIR): continue
            src = open(p, encoding='utf-8').read()
            out = LIT.sub(lambda m: m.group(0)[0] + corrigir(m.group(0)[1:-1], tot) + m.group(0)[-1], src)
            if out != src:
                arqs += 1
                if gravar: open(p, 'w', encoding='utf-8').write(out)
    print(('GRAVADO' if gravar else 'RELATÓRIO'), 'strings corrigidas:', tot[0], 'arquivos:', arqs)
if __name__ == '__main__': main()
