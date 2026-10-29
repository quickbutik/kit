import { useId, type ReactNode } from "react";
import type { Language } from "@/lib/localization";

// Every flag is drawn in the same 4:3 frame so they line up in a list.
export default function Flag({ language }: { language: Language }) {
  const clip = useId();
  const flags: Record<Language, ReactNode> = {
    sv: (
      <>
        <path fill="#006aa7" d="M0 0h640v480H0z" />
        <path fill="#fecc02" d="M176 0h96v192h368v96H272v192h-96V288H0v-96h176z" />
      </>
    ),
    dk: (
      <>
        <path fill="#c8102e" d="M0 0h640v480H0z" />
        <path fill="#fff" d="M206 0h68v206h366v68H274v206h-68V274H0v-68h206z" />
      </>
    ),
    no: (
      <>
        <path fill="#ba0c2f" d="M0 0h640v480H0z" />
        <path fill="#fff" d="M180 0h120v180h340v120H300v180H180V300H0V180h180z" />
        <path fill="#00205b" d="M210 0h60v210h370v60H270v210h-60V270H0v-60h210z" />
      </>
    ),
    en: (
      <>
        <clipPath id={clip}>
          <path d="M320 240h320v240zv240H0zH0V0zV0h320z" />
        </clipPath>
        <path fill="#012169" d="M0 0h640v480H0z" />
        <path stroke="#fff" strokeWidth="96" d="m0 0 640 480m0-480L0 480" />
        <path
          stroke="#c8102e"
          strokeWidth="64"
          clipPath={`url(#${clip})`}
          d="m0 0 640 480m0-480L0 480"
        />
        <path stroke="#fff" strokeWidth="160" d="M320 0v480M0 240h640" />
        <path stroke="#c8102e" strokeWidth="96" d="M320 0v480M0 240h640" />
      </>
    ),
  };
  return (
    <svg className="flag" viewBox="0 0 640 480" aria-hidden="true">
      {flags[language]}
    </svg>
  );
}
