import { Link } from "@tanstack/react-router";
import { BrandMark } from "~/components/shell/BrandMark";
import type { HeaderProps } from "~/theme/slots";

/** A slim top bar: brand mark and name on the left, navigation and controls on the right. */
export default function Header({ brand, nav, localeSwitch, themeToggle }: HeaderProps) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link
          to="/"
          aria-label={brand.name}
          className="text-foreground no-underline hover:no-underline"
        >
          <span className="inline-flex items-center gap-2.5">
            <BrandMark logo={brand.logoUrl} name={brand.name} className="text-primary" />
            <span className="font-serif text-lg leading-none">{brand.name}</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          {nav}
          {localeSwitch}
          {themeToggle}
        </div>
      </div>
    </header>
  );
}
