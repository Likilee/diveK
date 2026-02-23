"use client";

import { useEffect, useState } from "react";

export function AdSlot() {
  const [renderVersion, setRenderVersion] = useState(0);

  useEffect(() => {
    const onVirtualPageEnter = () => {
      setRenderVersion((version) => version + 1);
    };

    window.addEventListener("kcontext:virtual-page-enter", onVirtualPageEnter);

    return () => {
      window.removeEventListener("kcontext:virtual-page-enter", onVirtualPageEnter);
    };
  }, []);

  return (
    <aside key={renderVersion} className="ad-shell" aria-label="광고 슬롯">
      <p className="ad-label">Ad Slot</p>
      <p className="ad-copy">Virtual page 진입 시 슬롯이 새로고침됩니다.</p>
    </aside>
  );
}
