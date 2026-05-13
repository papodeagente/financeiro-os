import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-[var(--lg-accent-fill)] text-[var(--lg-accent)] [a]:hover:bg-[var(--lg-accent)] [a]:hover:text-white",
        secondary:
          "bg-[var(--lg-material-thick)] text-[var(--lg-text-2)] [a]:hover:bg-[var(--lg-material-regular)]",
        destructive:
          "bg-[var(--lg-neg-fill)] text-[var(--lg-neg)] focus-visible:ring-[var(--lg-neg-fill)] [a]:hover:bg-[var(--lg-neg)] [a]:hover:text-white",
        outline:
          "border-[var(--lg-border-base)] text-[var(--lg-text-2)] [a]:hover:bg-[var(--lg-material-thick)]",
        ghost:
          "hover:bg-[var(--lg-material-thick)] hover:text-[var(--lg-text)]",
        link: "text-[var(--lg-accent)] underline-offset-4 hover:underline",
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
