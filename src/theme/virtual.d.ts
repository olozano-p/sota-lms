declare module "virtual:sota-theme-slots" {
  import type { ComponentType } from "react";
  import type { SlotComponents } from "~/theme/slots";
  /** One component per slot: the theme's own when it ships one, else the default. */
  export const slots: { [N in keyof SlotComponents]: ComponentType<SlotComponents[N]> };
  export const slotOrigin: Record<keyof SlotComponents, "theme" | "default">;
}
