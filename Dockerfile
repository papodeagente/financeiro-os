# Base fixada por digest (auditoria 04/11/2026, FIN-14): a tag "20-alpine"
# muda sozinha; o digest só muda quando alguém atualiza esta linha de
# propósito. Digest de node:20-alpine resolvido em 04/11/2026.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
# Next 16 typecheck em build pode estourar 2GB. Damos folga p/ ambientes
# com pouca RAM (Coolify) — sem isso o tsc morre silencioso apos
# "Running TypeScript ..." e o build retorna exit 255 sem stack trace.
ENV NODE_OPTIONS="--max-old-space-size=6144"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# su-exec: o entrypoint acerta o dono das pastas do volume (que já existem
# em produção, criadas como root) e então troca para o usuário "node" antes
# de subir a aplicação. A aplicação nunca roda como root.
RUN apk add --no-cache curl su-exec
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY entrypoint.sh ./entrypoint.sh
RUN chmod 0755 /app/entrypoint.sh
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["sh", "/app/entrypoint.sh"]
