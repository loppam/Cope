import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full h-12 px-4 rounded-[16px] bg-white/[0.02] border',
          'text-white placeholder:text-white/40',
          'focus:outline-none focus:ring-2 focus:ring-[#08b16b]/50',
          'transition-all',
          error ? 'border-[#FF4757]' : 'border-white/6',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
