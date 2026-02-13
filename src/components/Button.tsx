import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { triggerHaptic } from '@/lib/haptic';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'glass' | 'destructive' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, onPointerDown, ...props }, ref) => {
    return (
      <button
        ref={ref}
        onPointerDown={(e) => {
          if (!props.disabled && !isLoading) triggerHaptic();
          onPointerDown?.(e);
        }}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 rounded-xl font-medium select-none',
          'transition-[transform,background-color,color,border-color] duration-100 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'disabled:opacity-50 disabled:pointer-events-none active:disabled:scale-100',
          {
            // Primary - Solid Vibrant (Emerald Green)
            'bg-accent-primary text-[#000000] hover:bg-accent-hover active:scale-[0.97]':
              variant === 'primary',
            // Secondary - Solid Surface
            'bg-surface-2 text-white border border-border hover:bg-surface-3 active:scale-[0.97]':
              variant === 'secondary',
            // Outline
            'border border-white/20 text-white hover:bg-white/5 active:scale-[0.97]':
              variant === 'outline',
            // Ghost
            'text-text-secondary hover:text-white hover:bg-white/5 active:scale-[0.97]':
              variant === 'ghost',
            // Glass - Minimal
            'bg-white/5 text-white hover:bg-white/10 border border-white/5 active:scale-[0.97]':
              variant === 'glass',
            // Destructive
            'bg-error/10 text-error border border-error/20 hover:bg-error/20 active:scale-[0.97]':
              variant === 'destructive',
            // Icon
            'p-0 hover:bg-white/5 rounded-full text-text-secondary hover:text-white active:scale-95':
              variant === 'icon',
          },
          {
            'h-8 px-3 text-xs': size === 'sm',
            'h-10 px-4 text-sm': size === 'md',
            'h-12 px-6 text-base': size === 'lg',
            'h-8 w-8': size === 'sm' && variant === 'icon',
            'h-10 w-10': size === 'md' && variant === 'icon',
            'h-12 w-12': size === 'lg' && variant === 'icon',
          },
          className
        )}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading && (
          <span className="absolute inset-0 flex items-center justify-center bg-inherit rounded-inherit">
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          </span>
        )}
        <span className={cn('flex items-center gap-2', isLoading && 'invisible')}>
          {children}
        </span>
      </button>
    );
  }
);

Button.displayName = 'Button';
