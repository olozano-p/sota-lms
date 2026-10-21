import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Tabs are links: the selected tab is a fact of the URL, not component state. On a narrow screen
 * the row scrolls sideways: the selected tab is brought into view and the trailing edge fades
 * while more tabs are hidden behind it.
 */
export function Tabs({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [more, setMore] = useState(false);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const update = () => setMore(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
    const active = nav.querySelector<HTMLElement>(".active");
    if (active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    }
    update();
    nav.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      nav.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

  return (
    <nav
      ref={ref}
      aria-label={label}
      className={cn(
        "relative flex gap-1 overflow-x-auto border-b [scrollbar-width:none]",
        more && "[mask-image:linear-gradient(to_right,black_80%,transparent)]",
      )}
    >
      {children}
    </nav>
  );
}

export function Tab({ children, ...props }: LinkProps & { children: ReactNode }) {
  return (
    <Link
      {...props}
      className={cn(
        "label -mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-muted-foreground no-underline",
        "transition-colors duration-[120ms] ease-(--ease) hover:text-foreground hover:no-underline",
        "[&.active]:border-primary [&.active]:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
