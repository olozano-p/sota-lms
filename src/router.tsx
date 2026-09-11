import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

/** The CSP nonce the request middleware generated; nothing on the client. */
const currentNonce = createIsomorphicFn()
  .server(async () => {
    const { nonceStore } = await import("./server/security");
    return nonceStore.getStore();
  })
  .client(() => undefined);

export async function getRouter() {
  const nonce = await currentNonce();
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    ssr: nonce ? { nonce } : undefined,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>;
  }
}
