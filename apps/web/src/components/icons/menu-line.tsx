// Drawn in the MingCute line style (24px grid, 2px round stroke): the icon tool was unavailable for this task.
import type { SVGProps } from "react";

export function MenuLineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      {...props}
    >
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/>
    </svg>
  );
}
