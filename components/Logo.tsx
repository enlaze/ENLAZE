import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  /** Tamaño en píxeles del cuadrado del logo. Default: 36 */
  size?: number;
  /** Mostrar el wordmark "Enlaze" al lado. Default: true */
  showWordmark?: boolean;
  /** Ruta a la que navega al hacer click. Default: "/" */
  href?: string;
  /** Clases extra para el wrapper */
  className?: string;
  /** Color del wordmark (clase de Tailwind). Default: "text-navy-900" */
  wordmarkClassName?: string;
};

export default function Logo({
  size = 36,
  showWordmark = true,
  href = "/",
  className = "",
  wordmarkClassName = "text-navy-900",
}: LogoProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 select-none ${className}`}
      aria-label="Enlaze"
    >
      <Image
        src="/logo.png"
        alt="Enlaze"
        width={size}
        height={size}
        priority
        className="shrink-0"
      />
      {showWordmark && (
        <span
          className={`font-semibold tracking-tight ${wordmarkClassName}`}
          style={{ fontSize: Math.round(size * 0.5) }}
        >
          Enlaze
        </span>
      )}
    </Link>
  );
}
