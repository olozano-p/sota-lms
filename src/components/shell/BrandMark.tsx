import { cn } from "~/lib/cn";

/**
 * Default mark: an open book drawn as two leaning strokes and a spine. Replaced by
 * the theme's `logo` (theme.json) when a deployment supplies one.
 */
export function BrandMark({
  className,
  logo,
  name,
}: {
  className?: string;
  logo: string | null;
  name: string;
}) {
  if (logo) return <img src={logo} alt={name} className={cn("h-7 w-auto", className)} />;
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("size-7", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 9.5c-2.2-2-5.4-2.6-9-2v16c3.6-.6 6.8 0 9 2 2.2-2 5.4-2.6 9-2v-16c-3.6-.6-6.8 0-9 2Z" />
      <path d="M16 9.5v16" />
    </svg>
  );
}
