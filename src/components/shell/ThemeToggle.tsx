import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "~/i18n";
import { Button } from "~/components/ui/button";

const KEY = "sota_theme";

/**
 * Light is the default: this inline `<script>` in the document head adds `.dark` before first
 * paint only when the visitor chose it.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");
const serverSnapshot = () => false;

export function ThemeToggle() {
  const { t } = useI18n();
  const dark = useSyncExternalStore(subscribe, isDark, serverSnapshot);

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Private mode or storage disabled: the toggle still works for this page view.
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={t("theme.toggle")}
      aria-pressed={dark}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
