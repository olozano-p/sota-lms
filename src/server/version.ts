import pkg from "../../package.json" with { type: "json" };

/** The running build's version (`package.json`), reported by `/api/health`. */
export const APP_VERSION: string = pkg.version;
