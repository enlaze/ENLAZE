import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://enlaze.es";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/api/", "/portal/", "/onboarding/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
