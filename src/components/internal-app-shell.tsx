import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type InternalAppShellProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function InternalAppShell({
  title,
  description,
  icon: Icon,
  children,
  footer,
  className,
}: InternalAppShellProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Card className="border-primary/15 bg-card/80 shadow-sm ring-1 ring-primary/10">
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg sm:text-xl">{title}</CardTitle>
                  <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Internal application
                  </span>
                </div>
                <CardDescription className="text-sm">{description}</CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        {footer ? <CardContent className="pt-0">{footer}</CardContent> : null}
      </Card>
      {children}
    </div>
  );
}
