"use client";
export default function Error({ error }: { error: Error }) { return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Error loading page: {error.message}</div>; }
