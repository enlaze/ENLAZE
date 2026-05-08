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
        <img
          src="/logo.png"
          alt="Enlaze"
          width={80}
          height={80}
          draggable={false}
        />
      </div>
    </div>
  );
}
