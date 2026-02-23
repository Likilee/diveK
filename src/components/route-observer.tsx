"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { refreshAdSlots, trackVirtualPageview } from "@/lib/analytics";

export function RouteObserver() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousRouteRef = useRef<string | null>(null);

  const routeKey = useMemo(() => {
    const search = searchParams.toString();
    return search ? `${pathname}?${search}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (previousRouteRef.current === routeKey) {
      return;
    }

    previousRouteRef.current = routeKey;
    trackVirtualPageview(routeKey);
    refreshAdSlots(routeKey);
  }, [routeKey]);

  return null;
}
