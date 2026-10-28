import { useEffect, useRef, useState } from "react";

export type AdMaxBannerSize = { width: number; height: number };

// Owner-confirmed slot 1237257: PulseLane_SP_320x50. No resizing or overlay.
// The numeric management slot ID is not the script token; keep the supplied tag below.
export const ADMAX_BANNER_SIZE: AdMaxBannerSize = { width: 320, height: 50 };

export const ADMAX_DOCUMENT = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent}</style></head><body>
<!-- admax -->
<script src="https://adm.shinobi.jp/s/cb996f4b2cbc2c0b8adc2c12ad721c8f"></script>
<!-- admax -->
</body></html>`;

/** One document per visible placement; never inject vendor scripts into React's document. */
export function AdMaxBanner({ size = ADMAX_BANNER_SIZE }: { size?: AdMaxBannerSize | null }) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    if (!size || !container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [size]);

  if (
    !size ||
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  )
    return null;

  // Do not shrink or crop a fixed-size creative. No request when the slot cannot fit.
  return (
    <div ref={container} className="mt-10 w-full min-w-0" data-admax-slot>
      {availableWidth >= size.width && (
        <section aria-label="広告" className="flex flex-col items-center gap-2">
          <p className="text-xs text-white/40">広告</p>
          <iframe
            title="広告 — 忍者AdMax"
            width={size.width}
            height={size.height}
            className="block shrink-0 border-0"
            style={{ width: size.width, height: size.height }}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            srcDoc={ADMAX_DOCUMENT}
          />
        </section>
      )}
    </div>
  );
}
