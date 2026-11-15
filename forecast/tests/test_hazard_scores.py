"""
Unit tests for Hazard Scoring Engine.
"""

import unittest
import numpy as np
import sys
from pathlib import Path

forecast_root = Path(__file__).resolve().parent.parent
if str(forecast_root) not in sys.path:
    sys.path.insert(0, str(forecast_root))

from src.hazard_scores import (
    compute_dust_risk,
    compute_wind_risk,
    compute_cold_risk,
    compute_heat_risk,
    compute_overall_risk,
    compute_all_hazard_rasters,
)


class TestHazardScores(unittest.TestCase):
    def test_dust_risk_monotonic(self):
        # Risk should increase as tau increases
        r0 = compute_dust_risk(0.1)
        r1 = compute_dust_risk(0.8)
        r2 = compute_dust_risk(2.0)
        self.assertLess(r0, r1)
        self.assertLess(r1, r2)
        self.assertTrue(0.0 <= r0 <= 1.0)
        self.assertTrue(0.0 <= r2 <= 1.0)

    def test_wind_risk_bounds(self):
        r_calm = compute_wind_risk(2.0)
        r_gale = compute_wind_risk(25.0)
        self.assertLess(r_calm, 0.3)
        self.assertGreater(r_gale, 0.7)

    def test_cold_risk_co2_frost(self):
        r_warm = compute_cold_risk(240.0)
        r_frost = compute_cold_risk(140.0)
        self.assertLess(r_warm, 0.25)
        self.assertGreater(r_frost, 0.8)

    def test_heat_risk(self):
        r_mod = compute_heat_risk(250.0)
        r_hot = compute_heat_risk(290.0)
        self.assertEqual(r_mod, 0.0)
        self.assertGreater(r_hot, 0.6)

    def test_overall_risk_max_priority(self):
        # A single lethal hazard (e.g. wind=35 m/s) should dominate overall risk
        r_d = compute_dust_risk(0.1)  # low
        r_w = compute_wind_risk(35.0)  # high (~0.9)
        r_c = compute_cold_risk(230.0)  # low
        r_h = compute_heat_risk(240.0)  # low
        r_all = compute_overall_risk(r_d, r_w, r_c, r_h)
        self.assertGreater(r_all, 0.70)

    def test_raster_computation_shape(self):
        shape = (36, 72)
        tsurf = np.full(shape, 210.0, dtype=np.float32)
        wind = np.full(shape, 8.0, dtype=np.float32)
        dust = np.full(shape, 0.3, dtype=np.float32)
        rasters = compute_all_hazard_rasters(tsurf, wind, dust)
        self.assertEqual(len(rasters), 6)
        for name, arr in rasters.items():
            self.assertEqual(arr.shape, shape)
            self.assertTrue(np.all(arr >= 0.0))
            self.assertTrue(np.all(arr <= 1.0))


if __name__ == "__main__":
    unittest.main()
