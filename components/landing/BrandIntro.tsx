"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const STORAGE_KEY = "enlaze:brand-intro:played:v6";

export default function BrandIntro() {
  const [stage, setStage] = useState<"hidden" | "playing" | "leaving" | "done">(
    "hidden"
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a11y skip
      setStage("done");
      return;
    }

    let alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      /* sessionStorage bloqueado */
    }
    if (alreadyPlayed) {
      setStage("done");
      return;
    }

    const STARTUP_DELAY = 80;
    const TOTAL = STARTUP_DELAY + 2400;

    const litTimer = setTimeout(() => setStage("playing"), STARTUP_DELAY + 40);
    const leaveTimer = setTimeout(() => setStage("leaving"), STARTUP_DELAY + 2000);
    const doneTimer = setTimeout(() => {
      setStage("done");
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* ignore */
      }
    }, TOTAL);

    return () => {
      clearTimeout(litTimer);
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (stage === "hidden" || stage === "done") return null;

  const rootClass = ["bi-root", "lit", stage === "leaving" ? "leaving" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div aria-hidden="true" className={rootClass}>
      <div className="logo-stage">
        <div className="logo-wrap">
          <Image
            src="/logo.png"
            alt=""
            width={200}
            height={200}
            priority
            draggable={false}
            className="logo"
          />
        </div>
      </div>

      <style jsx>{`
        .bi-root {
          position: fixed;
          inset: 0;
          z-index: 9999;
          overflow: hidden;
          pointer-events: none;
          background: #ffffff;
          opacity: 1;
          transition: opacity 400ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .bi-root.leaving {
          opacity: 0;
        }

        .logo-stage {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
        }

        .logo-wrap {
          position: relative;
          width: 220px;
          height: 220px;
          display: grid;
          place-items: center;
          opacity: 0;
          transform: scale(0.92);
          filter: blur(6px);
          transition:
            opacity 900ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms,
            transform 1100ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms,
            filter 900ms cubic-bezier(0.22, 0.7, 0.18, 1) 120ms;
        }
        .bi-root.lit .logo-wrap {
          opacity: 1;
          transform: scale(1);
          filter: blur(0);
        }

        .logo-wrap :global(.logo) {
          width: 200px !important;
          height: 200px !important;
          object-fit: contain;
          will-change: transform, opacity, filter;
        }
      `}</style>
    </div>
  );
}
