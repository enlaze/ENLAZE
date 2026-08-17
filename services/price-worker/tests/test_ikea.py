from __future__ import annotations

import unittest

from enlaze_price_worker.ikea import parse_ikea_json_ld


PRODUCT_URL = (
    "https://www.ikea.com/es/es/p/"
    "zebrasav-lampara-techo-marron-papel-pintado-60580077/"
)


class IkeaProductTests(unittest.TestCase):
    def setUp(self) -> None:
        self.document = {
            "@context": "https://schema.org/",
            "@type": "Product",
            "brand": {"@type": "Brand", "name": "IKEA"},
            "category": "Lámparas colgantes",
            "description": "Lámpara de techo para una reforma.",
            "name": "ZEBRASÄV Lámpara de techo - marrón/papel pintado 35 cm",
            "offers": {
                "@type": "Offer",
                "availability": "https://schema.org/InStock",
                "price": "7.99",
                "priceCurrency": "EUR",
                "seller": {"@type": "Organization", "name": "IKEA"},
                "url": PRODUCT_URL,
            },
            "sku": "605.800.77",
            "url": PRODUCT_URL,
        }

    def test_parses_official_product_page_evidence(self) -> None:
        product = parse_ikea_json_ld(
            [self.document],
            requested_url=PRODUCT_URL,
            observed_at="2026-08-17T17:00:00Z",
        )

        self.assertEqual(product.sku, "IKEA-605.800.77")
        self.assertEqual(product.price, 7.99)
        self.assertEqual(product.raw_price, "7,99 €")
        self.assertEqual(product.category, "iluminacion")
        self.assertTrue(product.price_includes_vat)
        self.assertEqual(product.vat_rate, 21)
        self.assertEqual(product.seller, "IKEA")
        self.assertEqual(product.evidence_type, "official_product_page")
        self.assertEqual(product.manufacturer_reference, "605.800.77")

    def test_rejects_non_ikea_seller(self) -> None:
        self.document["offers"]["seller"]["name"] = "Marketplace"

        with self.assertRaisesRegex(ValueError, "vendedor"):
            parse_ikea_json_ld([self.document], requested_url=PRODUCT_URL)

    def test_rejects_evidence_url_mismatch(self) -> None:
        self.document["offers"]["url"] = (
            "https://www.ikea.com/es/es/p/otro-producto-10522481/"
        )

        with self.assertRaisesRegex(ValueError, "no coincide"):
            parse_ikea_json_ld([self.document], requested_url=PRODUCT_URL)


if __name__ == "__main__":
    unittest.main()
