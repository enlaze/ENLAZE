"use client";

import { useEffect, useState } from "react";

export default function BrandIntro() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHidden(true), 1460);
    return () => clearTimeout(t);
  }, []);

  if (hidden) return null;

  return (
    <div id="intro" aria-hidden="true">
      <div id="logo">
        <img src="/logo.png" alt="Enlaze" draggable={false} />
      </div>

      <style jsx global>{`
        #intro {
          position: fixed;
          inset: 0;
          background: #000000;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
        }

        #intro #logo {
          width: 80px;
          height: 80px;
          flex-shrink: 0;
          opacity: 0;
          animation: brandIntroFadeInOut 1400ms ease 0ms forwards;
        }
        #intro #logo img {
          display: block;
          width: 80px;
          height: 80px;
          object-fit: contain;
        }

        @keyframes brandIntroFadeInOut {
          0%   { opacity: 0; }
          40%  { opacity: 1; }
          65%  { opacity: 1; }
          100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          #intro #logo { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
