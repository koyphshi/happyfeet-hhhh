"""
Unit tests for Mars Ephemeris and Calendar Engine.
"""

import unittest
from datetime import datetime, timezone
import sys
from pathlib import Path

# Add forecast root to sys.path
forecast_root = Path(__file__).resolve().parent.parent
if str(forecast_root) not in sys.path:
    sys.path.insert(0, str(forecast_root))

from src.mars_time import MarsTimeEngine, get_current_martian_date


class TestMarsTime(unittest.TestCase):
    def test_j2000_epoch(self):
        # J2000.0 epoch: 2000-01-01 12:00:00 UTC (11:58:51 UT / 12:00:00 TT)
        dt = datetime(2000, 1, 1, 11, 58, 51, tzinfo=timezone.utc)
        res = MarsTimeEngine.calculate_ephemeris(dt)
        self.assertTrue(270.0 <= res["ls_deg"] <= 280.0)

    def test_my34_perihelion_dust_storm_epoch(self):
        # In June 2018 (MY 34), a major planet-encircling dust storm occurred around Ls ~ 190-210 deg
        dt = datetime(2018, 6, 15, 0, 0, 0, tzinfo=timezone.utc)
        res = MarsTimeEngine.calculate_ephemeris(dt)
        self.assertEqual(res["mars_year"], 34)
        self.assertTrue(190.0 <= res["ls_deg"] <= 215.0)
        self.assertIn("dust storm season", res["season"])

    def test_current_date(self):
        res = get_current_martian_date()
        self.assertIn("mars_year", res)
        self.assertIn("ls_deg", res)
        self.assertTrue(0.0 <= res["ls_deg"] < 360.0)
        self.assertGreaterEqual(res["mars_year"], 38)


if __name__ == "__main__":
    unittest.main()
