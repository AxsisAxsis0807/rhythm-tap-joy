import { useEffect, useRef, useState } from "react";
import { ADMAX_BANNER_SIZE, attachAdMax } from "@/lib/admax";

function BannerContent() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) return attachAdMax(host.current);
    return undefined;
  }, []);
  return <div ref={host} style={{ width: 320, height: 50 }} data-admax-host />;
}

function MeasuredBanner() {
  const container = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);

  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setFits((entry?.contentRect.width ?? 0) >= ADMAX_BANNER_SIZE.width);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="mt-10 w-full min-w-0" data-admax-slot>
      {fits && (
        <section aria-label="広告" className="flex flex-col items-center gap-2">
          <p className="text-xs text-white/40">広告</p>
          <BannerContent />
        </section>
      )}
    </div>
  );
}

export function AdMaxBanner({ enabled = true }: { enabled?: boolean }) {
  return enabled ? <MeasuredBanner /> : null;
}
