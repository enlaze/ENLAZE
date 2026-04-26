"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type GradientTextProps = {
  children: ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  showBorder?: boolean;
};

const DEFAULT_COLORS = ["#0a1929", "#00c896", "#0a1929"];

export default function GradientText({
  children,
  className = "",
  colors = DEFAULT_COLORS,
  animationSpeed = 8,
  showBorder = false,
}: GradientTextProps) {
  const reduced = useReducedMotion();
  const gradient = `linear-gradient(to right, ${colors.join(", ")})`;

  const textStyle = {
    backgroundImage: gradient,
    backgroundSize: "200% 100%",
    WebkitBackgroundClip: "text" as const,
    backgroundClip: "text" as const,
    color: "transparent",
    WebkitTextFillColor: "transparent" as const,
  };

  const animate = reduced
    ? { backgroundPosition: "50% 50%" }
    : { backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] };

  const transition = reduced
    ? { duration: 0 }
    : {
        duration: animationSpeed,
        ease: "easeInOut" as const,
        repeat: Infinity,
      };

  const content = (
    <motion.span
      className={className}
      style={textStyle}
      animate={animate}
      transition={transition}
    >
      {children}
    </motion.span>
  );

  if (!showBorder) return content;

  return (
    <motion.span
      className="relative inline-block rounded-md p-[1px]"
      style={{
        backgroundImage: gradient,
        backgroundSize: "200% 100%",
      }}
      animate={animate}
      transition={transition}
    >
      <span className="relative inline-block rounded-[5px] bg-white px-1">
        {content}
      </span>
    </motion.span>
  );
}
