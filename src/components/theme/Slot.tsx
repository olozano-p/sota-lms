import {
  createContext,
  createElement,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import { slots } from "virtual:sota-theme-slots";
import type { SlotComponents, ThemeBrand } from "~/theme/slots";

/**
 * Renders the component bound to a theme slot: the theme's own when it ships one, else the default
 * (`src/theme/default/slots`). Slots are compiled in, so this renders on the server and hydrates
 * without Suspense. Routes and components render slots; nothing else decides layout.
 */
export function Slot<N extends keyof SlotComponents>({
  name,
  ...props
}: { name: N } & SlotComponents[N]) {
  // `slots` is a module constant, so the component identity is stable across renders.
  return createElement(
    slots[name] as ComponentType<SlotComponents[N]>,
    props as unknown as SlotComponents[N],
  );
}

export function useSlot<N extends keyof SlotComponents>(name: N): ComponentType<SlotComponents[N]> {
  return slots[name] as ComponentType<SlotComponents[N]>;
}

const BrandContext = createContext<ThemeBrand | null>(null);

/** The deployment's identity (from `theme.json`), for components that render a slot needing it. */
export function BrandProvider({ brand, children }: { brand: ThemeBrand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): ThemeBrand {
  const brand = useContext(BrandContext);
  if (!brand) throw new Error("useBrand outside BrandProvider");
  return brand;
}
