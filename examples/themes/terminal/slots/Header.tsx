import { Link } from "@tanstack/react-router";
import type { HeaderProps } from "~/theme/slots";

/** A prompt-style bar: `user@host:~$` and the name on the left, the controls on the right. */
export default function Header({ brand, nav, localeSwitch, themeToggle }: HeaderProps) {
  return (
    <header className="border-b border-dashed bg-background font-mono">
      <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link to="/" className="text-foreground no-underline! hover:no-underline!">
          <span className="text-primary">user@host:~$</span> {brand.name}
          <span className="animate-pulse text-primary" aria-hidden="true">
            _
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {nav}
          {localeSwitch}
          {themeToggle}
        </div>
      </div>
    </header>
  );
}
