"""
Traz as telas do Super Admin (escritas para fundo escuro) para a base clara
do sistema. Só mexe em src/app/admin/.

  superfície escura (bg --fin-text)  -> bg --fin-surface
  texto claro (--fin-text-on-fill)   -> texto --fin-text, EXCETO sobre preenchimento de destaque
  borda forte de fundo escuro        -> borda --fin-border
  hover escuro                       -> hover --fin-surface-2
"""
import os, re, sys
RAIZ = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'app', 'admin')
FILL_DESTAQUE = re.compile(r'(?<![\w:\[-])bg-\[var\(--fin-(?:accent|accent-hover|positive|negative|violet|info|warning)\)\](?!/)')
LIT = re.compile(r"""("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)""")
def trocar(c):
    n = c
    n = re.sub(r'(?<![\w\[-])hover:bg-\[var\(--fin-text\)\](?!/)', 'hover:bg-[var(--fin-surface-2)]', n)
    n = re.sub(r'(?<![\w:\[-])bg-\[var\(--fin-text\)\](?!/)', 'bg-[var(--fin-surface)]', n)
    if not FILL_DESTAQUE.search(n):
        n = re.sub(r'(?<![\w\[-])((?:hover:|focus:|group-hover:)?)text-\[var\(--fin-text-on-fill\)\]', lambda m: m.group(1) + 'text-[var(--fin-text)]', n)
    n = n.replace('border-[var(--fin-border-strong)]', 'border-[var(--fin-border)]')
    return n
total = 0
for raiz, _, fs in os.walk(RAIZ):
    for f in fs:
        if not f.endswith('.tsx') or f == 'layout.tsx': continue
        p = os.path.join(raiz, f); s = open(p, encoding='utf-8').read()
        out = LIT.sub(lambda m: m.group(0)[0] + trocar(m.group(0)[1:-1]) + m.group(0)[-1], s)
        if out != s:
            total += 1
            if '--gravar' in sys.argv: open(p, 'w', encoding='utf-8').write(out)
print(('GRAVADO' if '--gravar' in sys.argv else 'RELATÓRIO'), 'arquivos:', total)
