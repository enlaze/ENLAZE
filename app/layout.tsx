import type { Metadata } from "next";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";
import Navbar from "@/components/Navbar";


export const metadata: Metadata = {
  title: 'Enlaze – Automatiza la comunicación de tu empresa',
  description:
    'WhatsApp, emails, recordatorios y calendario en un solo lugar.',
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png' }],
    shortcut: '/icon.png',
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-white text-navy-900 antialiased">
  <SplashScreen />
  <Navbar />
  {children}
</body>

    </html>
  );
}