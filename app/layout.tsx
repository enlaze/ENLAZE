import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientThemeProvider } from "./theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import BrandIntro from "@/components/landing/BrandIntro";
import AnalyticsProvider from "@/components/AnalyticsProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: true,
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://enlaze.es";

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Enlaze",
  url: siteUrl,
  logo: `${siteUrl}/icon.png`,
  description:
    "Asistente con IA que hace el trabajo de oficina de autónomos y pymes: cobros, presupuestos y facturas.",
  sameAs: [],
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "hola@enlaze.es",
      availableLanguage: ["Spanish"],
    },
  ],
  areaServed: "ES",
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Enlaze",
  url: siteUrl,
  potentialAction: {
    "@type": "SearchAction",
    target: `${siteUrl}/?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Enlaze — Ocúpate de tu oficio. Del papeleo nos ocupamos nosotros.",
    template: "%s | Enlaze",
  },
  description:
    "Enlaze es el asistente con IA que hace el trabajo de oficina de autónomos y pymes: cada mañana te dice qué cobrar, a quién contestar y qué presupuesto mandar, y te lo deja preparado.",
  keywords: [
    "asistente para autónomos",
    "trabajo de oficina",
    "presupuestos",
    "recordatorios de cobro",
    "facturas de proveedor",
    "enlaze",
  ],
  authors: [{ name: "Enlaze" }],
  creator: "Enlaze",
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: siteUrl,
    siteName: "Enlaze",
    title: "Enlaze — Ocúpate de tu oficio. Del papeleo nos ocupamos nosotros.",
    description:
      "Enlaze es el asistente con IA que hace el trabajo de oficina de autónomos y pymes: cada mañana te dice qué cobrar, a quién contestar y qué presupuesto mandar, y te lo deja preparado.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Enlaze — Ocúpate de tu oficio. Del papeleo nos ocupamos nosotros.",
    description:
      "Cada mañana te dice qué cobrar, a quién contestar y qué presupuesto mandar, y te lo deja preparado.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      data-theme="light"
      className={inter.variable}
    >
      <head>
        {/* Prevent flash of wrong theme by reading theme preference before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const stored = localStorage.getItem('theme-preference');
                const isDark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (isDark) {
                  document.documentElement.classList.add('dark');
                  document.documentElement.setAttribute('data-theme', 'dark');
                } else {
                  document.documentElement.classList.remove('dark');
                  document.documentElement.setAttribute('data-theme', 'light');
                }
              } catch (e) {}
            `,
          }}
        />
        {/* JSON-LD structured data — un <script> por objeto (más
            compatible con parsers que iteran y leen `@context` por entrada). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd),
          }}
        />
      </head>
      <body className="bg-white text-navy-900 transition-colors dark:bg-zinc-950 dark:text-zinc-200 antialiased">
        <ClientThemeProvider>
          <AnalyticsProvider>
            <ToastProvider>
              <ConfirmProvider>
                <BrandIntro />
                {children}
              </ConfirmProvider>
            </ToastProvider>
          </AnalyticsProvider>
        </ClientThemeProvider>
      </body>
    </html>
  );
}

