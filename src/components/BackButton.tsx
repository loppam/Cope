import { ArrowLeft } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/utils';

interface BackButtonProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

export function BackButton({ onClick, label = 'Back', className }: BackButtonProps) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className={cn(
        'rounded-lg px-4 py-2 h-auto flex items-center gap-2',
        'bg-white/5 hover:bg-white/10 border-white/10',
        'text-white hover:text-white',
        className
      )}
    >
      <ArrowLeft className="w-4 h-4" />
      <span>{label}</span>
    </Button>
  );
}
