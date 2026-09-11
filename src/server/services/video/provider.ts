/**
 * Video lives with a provider; Lodrö stores an id and asks the provider for metadata and an
 * embed. Vimeo is the v1 implementation (docs/video-vimeo.md); YouTube, Mux or a self-hosted
 * player are contributions behind this interface.
 */
export interface VideoMetadata {
  external_id: string;
  title: string;
  duration_s: number | null;
  thumbnail_url: string | null;
}

export interface VideoEmbed {
  iframeSrc: string;
  /** Hostname the CSP `frame-src` must allow for this provider. */
  frameHost: string;
}

export interface VideoProvider {
  id: string;
  /** Accepts a URL or a bare id; validates it against the provider's API when a token is present. */
  resolve(input: string): Promise<VideoMetadata>;
  embed(externalId: string): VideoEmbed;
}
