import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-2xl border bg-card shadow-panel", className)} {...props} />;
export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pb-0", className)} {...props} />;
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-sm font-medium text-slate-600 dark:text-slate-300", className)} {...props} />;
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...props} />;
export const Badge = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", className)} {...props} />;
export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cn("h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary dark:bg-card dark:text-slate-100 dark:placeholder:text-slate-400", props.className)} />;
export const Select = ({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn("h-10 rounded-lg border bg-white px-3 text-sm dark:bg-card dark:text-slate-100", className)} {...props} />;
export const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button className={cn("inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 dark:disabled:text-slate-200", className)} {...props} />;
