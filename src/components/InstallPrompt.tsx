"use client";

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<{
    mounted: boolean;
    showPrompt: boolean;
    isIOS: boolean;
    isStandalone: boolean;
  }>({
    mounted: false,
    showPrompt: false,
    isIOS: false,
    isStandalone: false,
  });

  const showInstallPrompt = useCallback(() => {
    setState(prev => ({ ...prev, showPrompt: true }));
  }, []);

  useEffect(() => {
    // Detect environment on mount
    const standalone = window.matchMedia("(display-mode: standalone)").matches 
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    
    // Check if dismissed recently (within 7 days)
    const dismissedAt = localStorage.getItem("pwa-install-dismissed");
    let isDismissed = false;
    if (dismissedAt) {
      const dismissedDate = new Date(dismissedAt);
      const daysSinceDismissed = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
      isDismissed = daysSinceDismissed < 7;
    }
    
    // Use queueMicrotask to avoid synchronous setState in effect
    queueMicrotask(() => {
      setState(prev => ({
        ...prev,
        mounted: true,
        isIOS: isIOSDevice,
        isStandalone: standalone,
      }));
    });

    // Don't proceed if already dismissed or standalone
    if (isDismissed || standalone) {
      return;
    }

    // Show iOS prompt after a delay if on iOS and not standalone
    if (isIOSDevice) {
      const timer = setTimeout(() => {
        showInstallPrompt();
      }, 3000);
      return () => clearTimeout(timer);
    }

    // Listen for beforeinstallprompt event (Chrome, Edge, etc.)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show prompt after a short delay
      setTimeout(() => {
        showInstallPrompt();
      }, 3000);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, [showInstallPrompt]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === "accepted") {
      setState(prev => ({ ...prev, showPrompt: false }));
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setState(prev => ({ ...prev, showPrompt: false }));
    localStorage.setItem("pwa-install-dismissed", new Date().toISOString());
  };

  // Don't show if not mounted, already installed, or not showing
  if (!state.mounted || state.isStandalone || !state.showPrompt) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "var(--bg, #11141b)",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        padding: "16px 20px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        zIndex: 9999,
        maxWidth: "360px",
        width: "calc(100% - 40px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            backgroundColor: "#63b3ed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            fontWeight: "bold",
            color: "white",
            flexShrink: 0,
          }}
        >
          B
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--text-inverse, #fff)", marginBottom: "4px" }}>
            Install Budget Tracker
          </div>
          <div style={{ fontSize: "13px", color: "var(--muted, #a0aec0)", lineHeight: 1.4 }}>
            {state.isIOS 
              ? "Tap the share button and select \"Add to Home Screen\" to install this app."
              : "Install this app on your device for quick access and offline use."
            }
          </div>
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: "none",
            border: "none",
            padding: "4px",
            cursor: "pointer",
            color: "var(--muted, #a0aec0)",
            fontSize: "18px",
            lineHeight: 1,
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      
      {!state.isIOS && deferredPrompt && (
        <div style={{ marginTop: "12px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={handleDismiss}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              backgroundColor: "transparent",
              color: "var(--muted, #a0aec0)",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Not now
          </button>
          <button
            onClick={handleInstall}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#63b3ed",
              color: "#11141b",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Install
          </button>
        </div>
      )}
      
      {state.isIOS && (
        <div style={{ 
          marginTop: "12px", 
          padding: "10px 12px", 
          backgroundColor: "var(--surface, rgba(255,255,255,0.03))", 
          borderRadius: "8px",
          fontSize: "12px",
          color: "var(--muted, #a0aec0)",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          <span style={{ fontSize: "18px" }}>📤</span>
          <span>Look for the <strong>Share</strong> icon at the bottom of Safari</span>
        </div>
      )}
    </div>
  );
}
