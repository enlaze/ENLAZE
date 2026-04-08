import Image from 'next/image';
import Link from 'next/link';

export default function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo.png" alt="Enlaze" width={32} height={32} />
      <span className="font-semibold text-lg">Enlaze</span>
    </Link>
  );
}