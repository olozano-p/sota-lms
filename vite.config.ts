import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sotaTheme } from "./src/theme/vite-plugin.ts";

export default defineConfig(({ mode }) => {
  // Slots are compiled in: the theme directory is read at build (and dev-server start) time.
  const themeDir = process.env.THEME_DIR ?? loadEnv(mode, process.cwd(), "").THEME_DIR;
  return {
    // 3000–3002 are held by other projects on the dev machine.
    server: { port: Number(process.env.PORT ?? 3003), strictPort: true },
    resolve: { tsconfigPaths: true },
    plugins: [
      sotaTheme({ themeDir: themeDir || "theme", explicit: Boolean(themeDir) }),
      tanstackStart(),
      react(),
      tailwindcss(),
    ],
    ssr: {
      // Native or Node-only modules: required at runtime, never bundled.
      external: ["pg", "isomorphic-dompurify", "nodemailer"],
    },
  };
});
