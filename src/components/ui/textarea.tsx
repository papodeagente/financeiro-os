import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[10px] border border-[var(--lg-border-base)] bg-[var(--t-input-bg)] px-2.5 py-2 text-base transition-all duration-200 outline-none placeholder:text-[var(--lg-text-3)] focus-visible:border-[var(--lg-accent)] focus-visible:ring-3 focus-visible:ring-[var(--lg-accent-fill)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--lg-neg)] aria-invalid:ring-3 aria-invalid:ring-[var(--lg-neg-fill)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
