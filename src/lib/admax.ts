// Owner-confirmed SP banner, management slot 1237257 (not the tag token).
export const ADMAX_ID = "cb996f4b2cbc2c0b8adc2c12ad721c8f";
export const ADMAX_SDK_URL = "https://adm.shinobi.jp/st/t.js";
export const ADMAX_BANNER_SIZE = { width: 320, height: 50 } as const;

type Request = { admax_id: string; type: "banner" };
type Queue = { push: (request: Request) => unknown };
declare global {
  interface Window {
    admaxads?: Queue;
  }
}

type Session = {
  node: HTMLDivElement;
  owner: HTMLElement | null;
  sdk: Promise<boolean> | null;
  requested: boolean;
};
const sessions = new WeakMap<Document, Session>();

function sessionFor(doc: Document): Session {
  let session = sessions.get(doc);
  if (!session) {
    const node = doc.createElement("div");
    node.className = "admax-ads";
    node.dataset["admaxId"] = ADMAX_ID;
    node.style.display = "inline-block";
    session = { node, owner: null, sdk: null, requested: false };
    sessions.set(doc, session);
  }
  return session;
}

/** One terminal attempt per document. Failure never blocks the application or retries. */
function loadSdk(doc: Document, session: Session): Promise<boolean> {
  if (!session.sdk) {
    session.sdk = new Promise((resolve) => {
      const script = doc.createElement("script");
      script.type = "text/javascript";
      script.charset = "utf-8";
      script.src = ADMAX_SDK_URL;
      script.async = true;
      script.addEventListener("load", () => resolve(true), { once: true });
      script.addEventListener("error", () => resolve(false), { once: true });
      try {
        doc.head.appendChild(script);
      } catch {
        resolve(false);
      }
    });
  }
  return session.sdk;
}

/**
 * Keep the vendor-owned subtree intact between eligible screens. No SDK reinjection,
 * private-global resets, refresh timers, or second request on a navigation/resize.
 * The public queue's post-load push and detached-subtree compatibility still need
 * live AdMax verification; our fixture is deliberately not a vendor guarantee.
 */
export function attachAdMax(host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const session = sessionFor(doc);
  // Reject an accidental second simultaneous placement for this same ID.
  if (session.owner) return () => {};
  session.owner = host;
  host.appendChild(session.node);
  let active = true;

  // Cancel StrictMode's discarded effect before loading or registering anything.
  queueMicrotask(() => {
    if (!active) return;
    const win = doc.defaultView;
    if (!win) return;
    win.admaxads ||= [] as Request[];
    void loadSdk(doc, session).then((loaded) => {
      if (!loaded || !active || session.owner !== host || !session.node.isConnected) return;
      if (session.requested) return;
      // Set before calling third-party code, including if it throws synchronously.
      session.requested = true;
      try {
        (win.admaxads ||= [] as Request[]).push({ admax_id: ADMAX_ID, type: "banner" });
      } catch {
        // No retry and no application dependency on advertising success.
      }
    });
  });

  return () => {
    active = false;
    if (session.owner !== host) return;
    session.node.remove();
    session.owner = null;
  };
}
