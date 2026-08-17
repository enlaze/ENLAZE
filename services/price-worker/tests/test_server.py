import unittest
from pathlib import Path

from enlaze_price_worker.server import (
    PriceWorkerServerConfig,
    health_payload,
    send_precondition_error,
)


class PriceWorkerServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = PriceWorkerServerConfig(
            state_dir=Path(".state-test"),
            api_url="",
            api_key="",
            send_enabled=False,
        )

    def test_health_is_local_and_reports_send_guard(self) -> None:
        payload = health_payload(self.config, running=False)

        self.assertTrue(payload["ok"])
        self.assertFalse(payload["send_enabled"])
        self.assertFalse(payload["running"])

    def test_send_endpoint_is_fail_closed(self) -> None:
        result = send_precondition_error(self.config)

        self.assertIsNotNone(result)
        self.assertEqual(result[0], 403)


if __name__ == "__main__":
    unittest.main()
