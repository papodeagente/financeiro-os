import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 px-3 py-2 text-base md:text-sm w-full min-w-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] transition-[border-color,box-shadow] duration-[var(--fin-dur-rapida)] placeholder:text-[var(--fin-text-3)] focus-visible:border-[var(--fin-accent)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--fin-surface-2)] disabled:opacity-60 aria-invalid:border-[var(--fin-negative)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
