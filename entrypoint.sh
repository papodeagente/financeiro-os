#!/bin/sh
# Ensure uploads directory exists and is writable
mkdir -p /app/data/uploads
# Comprovantes de pagamento e recebimento. Pasta separada de uploads
# porque uploads e servida por rota publica (proposta do cliente) e
# comprovante tem dado bancario: so sai por rota autenticada.
mkdir -p /app/data/comprovantes
node server.js
