"use client";

import { usePathname } from "next/navigation";
import { useState, ViewTransition } from "react";

function isClub(pathname: string) {
  return /^\/[^/]+\/club\/?$/.test(pathname);
}

export default function StoreThemeTransition() {
  const pathname = usePathname();
  const [navigation, setNavigation] = useState({ pathname, fade: false });

  // Decide in the navigation render, before React captures either palette.
  // Effects run too late to classify the transition before its snapshots.
  if (navigation.pathname !== pathname) {
    setNavigation({
      pathname,
      fade: isClub(navigation.pathname) !== isClub(pathname),
    });
  }

  return (
    <ViewTransition
      default="none"
      update={navigation.fade ? "club-theme-fade" : "none"}
    >
      <div
        className="store-theme-backdrop"
        data-theme={isClub(pathname) ? "club" : "shop"}
        data-theme-changing={navigation.fade}
        aria-hidden="true"
      />
    </ViewTransition>
  );
}
