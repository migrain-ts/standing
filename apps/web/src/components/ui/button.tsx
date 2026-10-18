import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Pulseboard Button — dark analytics board, glowing electric-violet primary.
// default/primary: saturated violet fill, violet rim, soft outer glow + inset
// highlight (the --shadow-glow material reused by checkbox/switch/radio/slider).
// secondary/outline/ghost: dark panels over the canvas.

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium",
    "rounded-md transition-all duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.98] active:brightness-95",
  ].join(" "),
  {
    variants: {
      variant: {
        // Hero — glowing violet material.
        default:
          "bg-primary text-primary-foreground " +
          "[box-shadow:var(--shadow-glow)] " +
          "hover:bg-primary/95 hover:[box-shadow:var(--shadow-glow-hover)]",
        primary:
          "bg-primary text-primary-foreground " +
          "[box-shadow:var(--shadow-glow)] " +
          "hover:bg-primary/95 hover:[box-shadow:var(--shadow-glow-hover)]",
        // Secondary: dark panel, border, subtle shadow.
        secondary:
          "bg-secondary text-secondary-foreground " +
          "border border-border " +
          "[box-shadow:0_1px_2px_oklch(0_0_0/0.25)] " +
          "hover:bg-accent hover:border-border/60",
        outline:
          "border border-border bg-transparent text-foreground " +
          "hover:bg-secondary hover:border-border/80",
        ghost:
          "bg-transparent text-muted-foreground " +
          "hover:bg-secondary hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground " +
          "[box-shadow:0_0_0_1px_oklch(from_var(--destructive)_l_c_h/0.5),0_1px_3px_oklch(0_0_0/0.35)] " +
          "hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm:      "h-8 px-3 text-xs rounded-md",
        default: "h-9 px-4",
        lg:      "h-10 px-6 text-sm",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends Omit<ButtonPrimitive.Props, "className">,
    VariantProps<typeof buttonVariants> {
  className?: string;
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // Callers written against the Radix API pass the element to become as a
    // child: <Button asChild><Link>…</Link></Button>. Base UI has no asChild,
    // it composes through `render`. Without this the prop reaches the DOM and
    // the anchor nests inside the button instead of replacing it, which stacks
    // the icon above the label and puts a link inside a button.
    if (asChild && React.isValidElement(props.children)) {
      const { children, ...rest } = props
      return (
        <ButtonPrimitive
          ref={ref}
          className={cn(buttonVariants({ variant, size, className }))}
          {...rest}
          // After the spread, so an explicit asChild child wins over a stray
          // render prop rather than being silently replaced by it.
          // SAFETY: this branch runs only when `asChild` is set, and the caller then
          // owns passing a single element for the slot to clone.
          render={children as React.ReactElement}
        />
      );
    }

    return (
      <ButtonPrimitive
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
