import { ArrowLeftIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Brand } from './brand';

export function ScreenShell({
  title,
  kicker,
  description,
  onBack,
  actions,
  children,
  className,
}: {
  title: string;
  kicker: string;
  description?: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('screen screen-sheet screen-scroll', className)}>
      <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col px-4 md:px-8 xl:px-12">
        <header className="sticky top-0 z-30 -mx-4 border-b border-border/80 bg-[#080d10]/92 px-4 py-3 backdrop-blur-md md:-mx-8 md:px-8 xl:-mx-12 xl:px-12">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back to the main menu"
              className="shrink-0"
            >
              <ArrowLeftIcon />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="data-label mb-1">{kicker}</div>
              <h1 className="headline truncate text-3xl text-paper md:text-4xl">{title}</h1>
            </div>
            <div className="flex items-center gap-4">
              {actions}
              <div className="hidden md:block">
                <Brand compact />
              </div>
            </div>
          </div>
          {description ? (
            <p className="mt-2 max-w-2xl pl-11 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>
        <div className="flex-1 py-5 md:py-7">{children}</div>
      </div>
    </section>
  );
}
