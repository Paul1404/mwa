import * as React from "react";
import { cn } from "~/lib/utils";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium text-[color:var(--color-text)] leading-none", className)}
    {...props}
  />
));
Label.displayName = "Label";
