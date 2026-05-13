import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-[10px] border border-[var(--lg-border-base)] bg-[var(--t-input-bg)] px-2.5 py-1 text-base transition-all duration-200 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[var(--lg-text-3)] focus-visible:border-[var(--lg-accent)] focus-visible:ring-3 focus-visible:ring-[var(--lg-accent-fill)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--lg-neg)] aria-invalid:ring-3 aria-invalid:ring-[var(--lg-neg-fill)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
