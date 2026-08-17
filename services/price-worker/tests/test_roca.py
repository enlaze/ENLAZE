from __future__ import annotations

import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from enlaze_price_worker.bc3 import ROCA_CATALOG_URL, parse_roca_catalog


FIXTURE = Path(__file__).parent / "fixtures" / "roca-mini.bc3"


class RocaCatalogTests(unittest.TestCase):
    def test_parses_official_price_evidence(self) -> None:
        products = parse_roca_catalog(FIXTURE)

        self.assertEqual(len(products), 3)
        bathtub = products[0]
        self.assertEqual(bathtub.sku, "ROCA-A212106001")
        self.assertEqual(bathtub.price, 169.0)
        self.assertEqual(bathtub.raw_price, "169,00 €")
        self.assertEqual(bathtub.category, "sanitarios")
        self.assertEqual(bathtub.subcategory, "baneras")
        self.assertFalse(bathtub.price_includes_vat)
        self.assertEqual(bathtub.vat_rate, 21)
        self.assertEqual(bathtub.product_url, ROCA_CATALOG_URL)
        self.assertEqual(bathtub.evidence_type, "official_bc3_catalog")
        self.assertEqual(bathtub.catalog_published_at, "2026-06-30")
        self.assertEqual(
            bathtub.catalog_sha256,
            hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
        )
        self.assertIn("colección Contesa", bathtub.description)
        self.assertEqual(products[2].sku, "ROCA-A341681000")

    def test_reads_a_single_bc3_from_zip(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = Path(temp_dir) / "roca.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.write(FIXTURE, "roca.bc3")

            products = parse_roca_catalog(archive_path)

        self.assertEqual([product.sku for product in products], [
            "ROCA-A212106001",
            "ROCA-A3420A0001",
            "ROCA-A341681000",
        ])

    def test_rejects_zip_with_multiple_bc3_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = Path(temp_dir) / "invalid.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.write(FIXTURE, "one.bc3")
                archive.write(FIXTURE, "two.bc3")

            with self.assertRaisesRegex(ValueError, "exactamente un archivo BC3"):
                parse_roca_catalog(archive_path)


if __name__ == "__main__":
    unittest.main()
