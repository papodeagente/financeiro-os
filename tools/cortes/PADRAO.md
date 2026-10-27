# Padrão Entur de Cortes

Padrão definitivo dos cortes verticais do Eclipse Experience e dos podcasts Entur.
Objetivo de todo corte: **prova social para o convidado e autoridade para o mentor (Bruno Barbosa)**,
inspirando os agentes de viagens que assistem.

## Formato

| Item | Padrão |
|---|---|
| Tamanho | 1080 × 1920, 30 fps, H.264 + AAC 48 kHz |
| Duração | 45 a 60 s de fala + 3 s de cartão final |
| Volume | -14 LUFS (padrão Reels/Shorts/TikTok) |
| Fonte | Poppins (Black nos títulos e legendas, Medium nos apoios) |

## Paleta roxa Entur

| Uso | Cor |
|---|---|
| Fundo profundo | `#100628` |
| Roxo profundo (degradê) | `#260E5C` |
| Roxo principal (destaques, palavra falada, barras) | `#7C3AED` |
| Lilás (palavras-chave, linhas de gráfico) | `#A78BFA` |
| Índigo Entur (brilhos) | `#5B6CF0` |
| Rosa (selos de alerta / "prova social") | `#EC4899` |

As cores ficam no topo de `scripts/padrao.py`. Se a marca tiver hex oficial diferente, troque só lá.

## Os dois layouts

### 1. DUPLA: conversa entre os dois
- Convidado **em cima**, mentor **embaixo**, costura roxa no meio.
- Quem está falando fica com a imagem cheia; quem escuta fica levemente escurecido.
- Legenda na costura. Plaquinhas de nome dos dois quando o layout entra.
- Use em trocas rápidas, perguntas e respostas curtas, reações.

### 2. SOLO: quando só um fala por mais tempo
- Animação no topo (0 a ~800 px), pessoa embaixo.
- A transição entre os dois é um **degradê de fumaça roxa** animado: o fundo roxo "escorre" sobre o topo do vídeo.
- Legenda na altura do peito (y ≈ 1480). Plaquinha de nome no rodapé quando a pessoa entra.
- Use nas falas de resultado, método e bastidores: é onde entram os gráficos.

## Blocos de animação (topo do layout solo)

| Bloco | Para quê | Dados |
|---|---|---|
| `manchete` | Gancho dos 3 primeiros segundos | `tag`, `linhas[]` (use `*palavra*` para destacar) |
| `numero` | Resultado em número com contador (faturamento, vendas, %) | `valor`, `prefixo`, `sufixo`, `rotulo`, `titulo` |
| `barras` | Antes x depois, mercado x cliente | `itens[{rotulo, valor 0-1, destaque, tag}]`, `nota` |
| `linha` | Curva de crescimento | `pontos[]`, `eixo[]`, `selo`, `nota` |
| `lista` | O que foi feito (método) com checks | `itens[{texto, t}]` |
| `citacao` | Frase forte de cliente/convidado | `linhas[{texto, t}]`, `autor`, `estrelas` |
| `etapas` | Jornada / passo a passo | `etapas[{texto, t}]` |
| `selo` | Marco de autoridade ("1ª", "+300") | `grande`, `linha1`, `linha2` |

O campo `t` dos itens é o segundo (dentro do bloco) em que o item aparece: sincronize com a fala.

## Regras de conteúdo

1. **Gancho nos 3 s**: começa pela frase mais forte (resultado ou contraste), com `manchete` ou `numero`.
2. **Prova social**: o resultado é dito pelo convidado, na voz dele, e reforçado no gráfico.
3. **Autoridade do mentor**: todo corte tem pelo menos uma fala do Bruno explicando o *porquê* (método, visão),
   e a plaquinha dele diz "Mentor de agências · Entur".
4. **Os dois participantes no mesmo corte**, sempre.
5. **Número só se foi dito** na entrevista. Gráfico de tendência sem número leva `*gráfico ilustrativo`.
6. Cartão final: frase-resumo em 2 linhas + pílula "Mentoria Entur" + `@papodeagente · ENTUR`.

## Áudio

- Trilha épica de fundo (padrão: Kevin MacLeod, CC BY 4.0: "Five Armies", "Volatile Reaction"). **Creditar na legenda do post.**
- A música abaixa sozinha durante as falas (cerca de -12 dB) e sobe nas pausas e no cartão final.
- Whoosh em cada troca de layout ou de gráfico, impacto grave na abertura e no cartão final.

## Como gerar um corte

```bash
# 1. transcrever a entrevista (palavra a palavra)
ffmpeg -i entrevista.mp4 -ac 1 -ar 16000 audio.wav
python3 scripts/transcribe.py audio.wav transcricao small

# 2. escrever o spec (veja specs/exemplo_jeri_corte1.json): trechos, layout, quem fala, gráficos
# 3. pré-visualizar quadros soltos
PREVIEW=1,10,20 python3 scripts/cortar.py specs/meu_corte.json transcricao.json trabalho/ saida.mp4
# 4. renderizar
python3 scripts/cortar.py specs/meu_corte.json transcricao.json trabalho/ saida.mp4
```

Dependências: `ffmpeg`, Python 3 com `numpy`, `pillow`, `faster-whisper`.

### Campos do spec

- `fonte`: caminho do vídeo original (1280×720).
- `pessoas`: `nome`, `papel`, `mentor` (true no Bruno), `solo_x` (x do recorte vertical 572×720 na fonte),
  `dupla_xy` (x,y do recorte 600×533 na fonte).
- `mentor` / `convidado`: chaves das pessoas (o convidado vai em cima no layout dupla).
- `clips`: trechos na ordem do corte: `quem`, `a`/`b` (segundos na fonte), `layout` (`solo`/`dupla`),
  `palavras` opcional para legenda manual, `remover` para tirar palavras da legenda.
- `graficos`: `t0`/`t1` no tempo do corte, `tipo` (bloco) e `dados`.
- `final`: `linhas`, `cta`, `assinatura`. `musica`: `arquivo`, `inicio`.
- `corrigir`: mapa de correções da transcrição (ex.: `{"Jariquacuara": "Jericoacoara"}`).
