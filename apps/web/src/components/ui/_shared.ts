export const formFieldBase =
  "w-full rounded-md px-3 text-sm " +
  "bg-input text-foreground " +
  "border border-border " +
  "[box-shadow:inset_0_1px_2px_oklch(0_0_0/0.3)] " +
  "placeholder:text-muted-foreground " +
  "transition-[color,border-color,box-shadow] duration-150 ease-out " +
  "hover:border-border/70 " +
  "focus-visible:outline-none focus-visible:border-primary/60 " +
  "focus-visible:[box-shadow:inset_0_1px_2px_oklch(0_0_0/0.2),0_0_0_3px_oklch(from_var(--primary)_l_c_h/0.3)] " +
  "disabled:cursor-not-allowed disabled:opacity-50"

export const formFieldSingleLine = "flex h-9 py-1.5"
export const formFieldMultiLine = "flex min-h-[80px] py-2 resize-y"
