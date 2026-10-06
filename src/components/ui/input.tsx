import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 lg:h-10 px-3 py-1 text-base md:text-sm file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--fin-text)] w-full min-w-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] transition-[border-color,box-shadow] duration-[var(--fin-dur-rapida)] placeholder:text-[var(--fin-text-3)] focus-visible:border-[var(--fin-accent)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--fin-surface-2)] disabled:opacity-60 aria-invalid:border-[var(--fin-negative)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
