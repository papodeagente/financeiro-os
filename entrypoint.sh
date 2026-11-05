#!/bin/sh
set -e
# Pastas do volume persistente (/app/data).
#  uploads      imagens públicas (proposta, mapa, perfil)
#  privado      documentos da agência: só saem com login ou URL assinada
#  comprovantes comprovantes de pagamento: só saem por rota autenticada
mkdir -p /app/data/uploads /app/data/privado /app/data/comprovantes

# A aplicação roda como "node", não como root (auditoria 04/11/2026, FIN-14).
# O volume de produção foi criado quando o contêiner rodava como root: aqui,
# ainda como root, as PASTAS passam a ser do "node" (para gravar e apagar).
# Os arquivos antigos continuam legíveis (permissão 644 padrão). Não é
# recursivo de propósito: com milhares de arquivos o boot ficaria lento.
if [ "$(id -u)" = "0" ]; then
  chown node:node /app/data /app/data/uploads /app/data/privado /app/data/comprovantes
  find /app/data -mindepth 2 -maxdepth 3 -type d -exec chown node:node {} + 2>/dev/null || true
  exec su-exec node node server.js
fi
exec node server.js
