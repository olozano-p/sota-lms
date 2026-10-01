import { Link } from "@tanstack/react-router";
import type { HeaderProps } from "~/theme/slots";

/** A centred masthead: the name in large small caps, the tagline, a double rule, then the controls. */
export default function Header({ brand, nav, localeSwitch, themeToggle }: HeaderProps) {
  return (
    <header className="bg-background">
      <div className="mx-auto flex w-full max-w-content flex-col items-center gap-2 px-4 pt-8 sm:px-6">
        <Link to="/" className="text-foreground no-underline! hover:no-underline!">
          <span className="font-serif text-5xl font-medium uppercase tracking-[0.08em] [font-variant:small-caps]">
            {brand.name}
          </span>
        </Link>
        {brand.tagline ? <p className="text-muted-foreground italic">{brand.tagline}</p> : null}
        <div className="mt-3 w-full border-y-4 border-double py-1" aria-hidden="true" />
        <div className="flex flex-wrap items-center justify-center gap-3 py-2">
          {nav}
          {localeSwitch}
          {themeToggle}
        </div>
      </div>
    </header>
  );
}
