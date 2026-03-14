import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-2xl border bg-card shadow-panel", className)} {...props} />;
export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pb-0", className)} {...props} />;
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-sm font-medium text-slate-600 dark:text-text-secondary", className)} {...props} />;
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...props} />;
export const Badge = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn("inline-flex h-6 max-w-full items-center rounded-md px-2.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", className)} {...props} />;
export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cn("h-10 w-full rounded-lg border bg-white px-3 text-sm text-foreground outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-primary dark:border-border dark:bg-surface-raised dark:text-foreground dark:placeholder:text-text-muted", props.className)} />;
export const Select = ({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn("h-10 rounded-lg border bg-white px-3 text-sm text-foreground dark:border-border dark:bg-surface-raised dark:text-foreground", className)} {...props} />;
export const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button className={cn("inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 dark:disabled:text-slate-200", className)} {...props} />;
