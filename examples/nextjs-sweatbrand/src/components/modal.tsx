"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Icon from "./icons";
import { usePreferences } from "./store-preferences";

export default function Modal({
  children,
  label,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const { t } = usePreferences();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const returnFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={label}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <span className="eyebrow">{label}</span>
        <button
          className="icon-button"
          aria-label={t("Close dialog")}
          onClick={onClose}
          autoFocus
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
