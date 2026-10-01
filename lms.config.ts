/**
 * Deployment configuration. Copy and edit in your fork, or mount your own file over this path in
 * the Docker image. Anything that names an organisation belongs here or in `.env`, never in src/.
 */
import { defineConfig } from "./src/config/schema.ts";

export default defineConfig({
  brand: {
    name: "SOTA",
    logo: null,
    colors: {},
  },
  locales: {
    default: "ca",
    enabled: ["ca", "es", "en"],
    cookieName: "sota_locale",
  },
  timeZone: "Europe/Madrid",
  embedAllowlist: ["player.vimeo.com", "www.youtube-nocookie.com", "docs.google.com"],
  uploads: {
    maxBytes: 200 * 1024 * 1024,
    allowedMime: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "text/plain",
      "application/zip",
    ],
  },
  notifications: {
    enabled: true,
    digestHour: 8,
  },
  forum: {
    general: true,
    imageMaxBytes: 5 * 1024 * 1024,
    pageSize: 25,
  },
  contactEmail: null,
});
