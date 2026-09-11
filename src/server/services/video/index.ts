import type { VideoProvider } from "./provider";
import { vimeoProvider } from "./vimeo";

const providers: Record<string, VideoProvider> = { [vimeoProvider.id]: vimeoProvider };

export function videoProvider(id: string): VideoProvider {
  const p = providers[id];
  if (!p) throw new Error(`unknown video provider "${id}"`);
  return p;
}

export function enabledVideoProviders(): VideoProvider[] {
  return Object.values(providers);
}

export type { VideoEmbed, VideoMetadata, VideoProvider } from "./provider";
