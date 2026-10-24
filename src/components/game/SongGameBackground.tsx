import { useCallback, useEffect, useRef, useState } from "react";
import type { SongBackgroundAsset } from "@/lib/songSettingsContract";
export function SongGameBackground({
  asset,
  resolve,
}: {
  asset: SongBackgroundAsset;
  resolve?: (() => Promise<SongBackgroundAsset | null>) | undefined;
}) {
  const [url, setUrl] = useState<string | null>(asset.url),
    attempted = useRef(false),
    lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setUrl(asset.url);
    attempted.current = false;
    return () => controller.abort();
  }, [asset.assetId, asset.hash, asset.url]);
  const refresh = useCallback(async () => {
    if (attempted.current) {
      setUrl(null);
      return;
    }
    attempted.current = true;
    const signal = lifecycle.current?.signal;
    try {
      const next = await resolve?.();
      if (signal?.aborted) return;
      setUrl(next?.assetId === asset.assetId && next.hash === asset.hash ? next.url : null);
    } catch {
      if (!signal?.aborted) setUrl(null);
    }
  }, [asset.assetId, asset.hash, resolve]);
  useEffect(() => {
    const timer = setTimeout(
      () => void refresh(),
      Math.max(0, asset.expiresAt - Date.now() - 30000),
    );
    return () => clearTimeout(timer);
  }, [asset.expiresAt, refresh]);
  return url ? (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      decoding="async"
      onError={() => void refresh()}
      className="pointer-events-none absolute inset-0 size-full object-cover"
    />
  ) : null;
}
