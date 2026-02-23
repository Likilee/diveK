declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    adsbygoogle?: unknown[];
  }
}

export function trackVirtualPageview(route: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof window.gtag === "function") {
    window.gtag("event", "page_view", {
      page_location: window.location.href,
      page_path: route,
      page_title: document.title,
    });
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    // Keep development visibility without shipping production noise.
    console.info("[ga4] virtual pageview", route);
  }
}

export function refreshAdSlots(route: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.adsbygoogle = window.adsbygoogle ?? [];
    window.adsbygoogle.push({ route });
  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.info("[adsense] slot refresh", route);
    }
  }

  window.dispatchEvent(new CustomEvent("kcontext:virtual-page-enter", { detail: { route } }));
}
