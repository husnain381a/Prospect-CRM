"use client";

import { useEffect, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/** Desktop navigation scrolls independently; the mobile drawer traps focus. */
export function NavigationShell({
  children,
  open,
  onOpenChange,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) onOpenChange(false);
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [onOpenChange]);

  return (
    <>
      <aside
        className="sidebar desktop-sidebar"
        aria-label="Workspace navigation"
      >
        {children}
      </aside>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="navigation-overlay" />
          <Dialog.Content
            id="mobile-navigation"
            className="sidebar navigation-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById("navigation-trigger")?.focus();
            }}
          >
            <Dialog.Title className="sr-only">
              Workspace navigation
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Choose a page or manage your account.
            </Dialog.Description>
            <Dialog.Close
              className="icon-button navigation-close"
              aria-label="Close navigation"
            >
              <X size={20} />
            </Dialog.Close>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
