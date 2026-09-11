import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // 3000–3002 are held by other projects on the dev machine.
  server: { port: Number(process.env.PORT ?? 3003), strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), react(), tailwindcss()],
  ssr: {
    // Native or Node-only modules: required at runtime, never bundled.
    external: ["pg", "isomorphic-dompurify", "nodemailer"],
  },
});
