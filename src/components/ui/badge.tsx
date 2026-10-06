import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** Etiqueta curta. Mesmo formato do StatusChip: retângulo de raio pequeno. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--fin-r-sm)] border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-[var(--fin-accent-soft)] text-[var(--fin-accent)] [a]:hover:bg-[var(--fin-accent)] [a]:hover:text-[var(--fin-text-on-fill)]",
        secondary:
          "border-[var(--fin-border)] bg-[var(--fin-surface-2)] text-[var(--fin-text-2)] [a]:hover:bg-[var(--fin-surface-sunken)]",
        destructive:
          "bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] [a]:hover:bg-[var(--fin-negative)] [a]:hover:text-[var(--fin-text-on-fill)]",
        outline:
          "border-[var(--fin-border)] text-[var(--fin-text-2)] [a]:hover:bg-[var(--fin-surface-2)]",
        ghost:
          "hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]",
        link: "text-[var(--fin-accent)] underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
