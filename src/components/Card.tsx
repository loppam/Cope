import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps {
  children: ReactNode;
  className?: string;
  glass?: boolean;
  onClick?: () => void;
}

export function Card({
  children,
  className,
  glass = false,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl p-5 transition-all duration-300 ease-out",
        glass
          ? "glass bg-surface-1/40 backdrop-blur-md border border-border-subtle" // Enhanced glass with backdrop
          : "bg-surface-1 border border-border-subtle", // Very dark gray card on black background
        onClick &&
          "cursor-pointer hover:bg-surface-2 hover:-translate-y-1 hover:shadow-lg hover:border-border-strong",
        className,
      )}
    >
      {children}
    </div>
  );
}
