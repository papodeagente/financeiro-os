"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Botão do sistema. Cinco papéis, três alturas.
 *
 * Altura: 44px abaixo de lg (alvo de toque) e 40px no desktop. O foco é o
 * anel global (outline de 2px na cor de destaque), igual em todo controle.
 * Texto sobre preenchimento usa --fin-text-on-fill, que escurece no tema
 * escuro junto com o azul que clareia: branco fixo ali daria 2,8:1.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--fin-r-md)] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-[var(--fin-dur-rapida)] select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[var(--fin-negative)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)]",
        outline:
          "border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]",
        secondary:
          "bg-[var(--fin-surface-2)] text-[var(--fin-text)] hover:bg-[var(--fin-surface-sunken)]",
        ghost:
          "text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] aria-expanded:bg-[var(--fin-surface-2)]",
        destructive:
          "bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative)] hover:text-[var(--fin-text-on-fill)]",
        link: "text-[var(--fin-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-11 gap-1.5 px-4 lg:h-10 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-[var(--fin-r-sm)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-11 lg:size-10",
        "icon-xs":
          "size-7 rounded-[var(--fin-r-sm)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
