import type { ReactNode } from "react";

type WorkspaceHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
};

export function WorkspaceHeader({ eyebrow, title, description, action }: WorkspaceHeaderProps) {
  return (
    <header className="flex flex-col gap-5 border-b border-border/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-serif text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
          {title}
        </h1>
        <div className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
