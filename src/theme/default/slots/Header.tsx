import { Link } from "@tanstack/react-router";
import { BrandMark } from "~/components/shell/BrandMark";
import type { HeaderProps } from "~/theme/slots";

/**
 * A slim bar on the page itself: the mark on the left (with the name when there is no logo),
 * navigation and controls on the right as labels (below the mark on a phone).
 */
export default function Header({ brand, nav, localeSwitch, themeToggle }: HeaderProps) {
  return (
    <header className="bg-background">
      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          to="/"
          aria-label={brand.name}
          className="text-foreground no-underline hover:no-underline"
        >
          <span className="inline-flex items-center gap-2.5">
            <BrandMark logo={brand.logoUrl} name={brand.name} className="h-8" />
            {brand.logoUrl ? null : (
              <span className="font-serif text-lg leading-none">{brand.name}</span>
            )}
          </span>
        </Link>
        {/* On a phone the account menu takes a row of its own below the mark and the controls; a
            lone sign-in link stays beside them. */}
        <div className="ml-auto max-sm:has-[>nav]:order-last max-sm:has-[>nav]:w-full">{nav}</div>
        <div className="flex items-center gap-1 sm:gap-3">
          {localeSwitch}
          {themeToggle}
        </div>
      </div>
    </header>
  );
}
