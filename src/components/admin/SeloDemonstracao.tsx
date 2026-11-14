/**
 * Selo da agência de demonstração (tenants.data.demo = true): fica fora das
 * contas da plataforma e não é cliente. Na lista e na ficha do Super Admin.
 */
export function SeloDemonstracao() {
  return (
    <span className="inline-flex rounded bg-[var(--fin-warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--fin-warning-text)]">
      Demonstração
    </span>
  )
}
