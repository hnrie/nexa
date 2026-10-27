import * as memoryIDB from "fake-indexeddb";

/** Each frame owns fresh stores. Never read, clear or modify the visitor's storage. */
export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)); },
    removeItem: (key) => { values.delete(String(key)); },
    clear: () => values.clear(),
  };
}

export function installDemoEnvironment(onBlocked: () => void): void {
  document.documentElement.setAttribute("data-demo", "");
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "indexedDB", { configurable: true, value: new memoryIDB.IDBFactory() });
  for (const [name, value] of Object.entries(memoryIDB)) {
    if (name.startsWith("IDB")) Object.defineProperty(window, name, { configurable: true, value });
  }
  // The real desktop bridge, if this homepage is opened inside Electron, is never exposed.
  if (Object.getOwnPropertyDescriptor(window, "evilionDesktop")?.configurable !== false) {
    Object.defineProperty(window, "evilionDesktop", { configurable: true, value: undefined });
  }
  Object.defineProperty(window, "caches", { configurable: true, value: undefined });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    // Only bundled artwork/catalogues may use fetch. No API, media proxy, links or third parties.
    if (url.origin === location.origin && /^(\/assets\/|\/twemoji\/)/.test(url.pathname) && (method === "GET" || method === "HEAD")) {
      return nativeFetch(input, { ...init, credentials: "omit" });
    }
    onBlocked();
    throw new DOMException("Demo network disabled", "NotAllowedError");
  };
  const blocked = () => { onBlocked(); throw new DOMException("Demo network disabled", "NotAllowedError"); };
  Object.defineProperty(window, "WebSocket", { configurable: true, value: class { constructor() { blocked(); } } });
  Object.defineProperty(window, "XMLHttpRequest", { configurable: true, value: class { constructor() { blocked(); } } });
  Object.defineProperty(window, "Worker", { configurable: true, value: class { constructor() { blocked(); } } });
  Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: class { constructor() { blocked(); } } });
  Object.defineProperty(window, "Notification", { configurable: true, value: class {
    static permission = "default";
    static async requestPermission() { onBlocked(); return "denied"; }
    constructor() { blocked(); }
  } });
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: () => false });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: async () => blocked(), getDisplayMedia: async () => blocked(), enumerateDevices: async () => [],
    addEventListener() {}, removeEventListener() {},
  } });
  // Native navigation, forms, file pickers and external links cannot escape the demo.
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest("a");
    const file = target?.closest('input[type="file"]');
    if (file || (link && !link.getAttribute("href")?.startsWith("/channels/"))) {
      event.preventDefault(); event.stopImmediatePropagation(); onBlocked();
    }
  }, true);
  document.addEventListener("submit", (event) => event.preventDefault());
  window.open = () => { onBlocked(); return null; };
}
