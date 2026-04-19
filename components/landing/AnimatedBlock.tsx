"use client";

import { useEffect, useRef, useState } from "react";

type AnimatedBlockProps = {
  children: React.ReactNode;
  /** Delay in ms before animation starts once in view */
  delay?: number;
  /** Vertical offset in px before entering (slide-up distance) */
  y?: number;
  /** Duration in ms */
  duration?: number;
  /** Tailwind class overrides or additions for the wrapper */
  className?: string;
  /** Render as a different element (default: div) */
  as?: keyof React.JSX.IntrinsicElements;
  /** When true, animate only the first time it enters view (default: true) */
  once?: boolean;
  /** Root margin for IntersectionObserver */
  rootMargin?: string;
};

/**
 * AnimatedBlock — scroll-triggered fade-in + slide-up using IntersectionObserver.
 * Equivalent to Framer Motion's `motion.div` + `useInView`, with zero dependencies.
 */
export default function AnimatedBlock({
  children,
  delay = 0,
  y = 40,
  duration = 650,
  className = "",
  as: Tag = "div",
  once = true,
  rootMargin = "0px 0px -80px 0px",
}: AnimatedBlockProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const node = ref.current;
    if (!node) return;

    // Respect reduced motion: show immediately without animation.
    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold: 0.12, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [once, rootMargin]);

  const style: React.CSSProperties = {
    transitionProperty: "opacity, transform",
    transitionDuration: `${duration}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    transitionDelay: `${delay}ms`,
    opacity: visible ? 1 : 0,
    transform: visible ? "translate3d(0,0,0)" : `translate3d(0,${y}px,0)`,
    willChange: "opacity, transform",
  };

  // Cast because TS generic JSX tag resolution is restrictive.
  const Component = Tag as React.ElementType;
  return (
    <Component
      ref={ref as React.Ref<HTMLElement>}
      className={className}
      style={style}
    >
      {children}
    </Component>
  );
}
