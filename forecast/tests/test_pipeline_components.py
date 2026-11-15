"""
Unit tests for Pipeline Components:
- Feature extraction & temporal dataset splitting
- Multi-target regularized ML regression & baseline models
- Model evaluation metrics
- Data access & physical climatology generation
"""

import unittest
import numpy as np
import sys
from pathlib import Path

forecast_root = Path(__file__).resolve().parent.parent
if str(forecast_root) not in sys.path:
    sys.path.insert(0, str(forecast_root))

from src.data_access import MarsDataAccess
from src.preprocessing import MarsFeatureExtractor, SimpleStandardScaler
from src.models import (
    MarsHybridForecaster,
    PersistenceBaseline,
    ClimatologyBaseline,
    RidgeMultiTargetRegressor,
)
from src.evaluation import ModelEvaluator


class TestPipelineComponents(unittest.TestCase):
    def test_physical_state_generation(self):
        state = MarsDataAccess.generate_synthetic_physical_state(ls_deg=45.0)
        self.assertEqual(state["tsurf"].shape, (36, 72))
        self.assertEqual(state["wind_speed"].shape, (36, 72))
        self.assertEqual(state["dustcol"].shape, (36, 72))

        # Check physical ranges
        self.assertTrue(np.all(state["tsurf"] >= 130.0))
        self.assertTrue(np.all(state["tsurf"] <= 310.0))
        self.assertTrue(np.all(state["wind_speed"] >= 0.0))
        self.assertTrue(np.all(state["dustcol"] >= 0.0))

    def test_feature_extractor(self):
        state = MarsDataAccess.generate_synthetic_physical_state(ls_deg=90.0)
        feats = MarsFeatureExtractor.extract_features_for_grid(
            state, state["lats"], state["lons"]
        )
        # Expected: 36 * 72 = 2592 cells, 11 features
        self.assertEqual(feats.shape, (2592, 11))
        # No NaNs or Infs
        self.assertFalse(np.isnan(feats).any())
        self.assertFalse(np.isinf(feats).any())

    def test_dataset_sequence_building(self):
        # 3 sols = 36 steps
        seq = MarsDataAccess.generate_sol_sequence(start_ls_deg=0.0, num_sols=3, steps_per_sol=12)
        self.assertEqual(len(seq), 36)

        x_all, y_all, meta = MarsFeatureExtractor.build_dataset_from_sequences(seq, lead_steps=12)
        # 36 - 12 = 24 time steps * 2592 cells = 62208 samples
        self.assertEqual(x_all.shape, (24 * 2592, 11))
        self.assertEqual(y_all.shape, (24 * 2592, 3))

    def test_temporal_split_no_leakage(self):
        x = np.arange(100).reshape(100, 1)
        y = np.arange(100).reshape(100, 1)
        x_tr, y_tr, x_val, y_val = MarsFeatureExtractor.train_val_split_temporal(x, y, train_fraction=0.8)

        self.assertEqual(len(x_tr), 80)
        self.assertEqual(len(x_val), 20)
        # Values in train must be strictly earlier than val
        self.assertLess(x_tr[-1, 0], x_val[0, 0])

    def test_ridge_multi_target_regression(self):
        np.random.seed(42)
        x = np.random.randn(200, 5).astype(np.float32)
        true_w = np.array([[1.0, -0.5], [0.0, 2.0], [-1.5, 0.3], [0.5, -1.0], [2.0, 1.0]], dtype=np.float32)
        y = x @ true_w + np.random.randn(200, 2).astype(np.float32) * 0.05

        model = RidgeMultiTargetRegressor(alpha=0.1)
        model.fit(x, y)
        preds = model.predict(x)

        self.assertEqual(preds.shape, (200, 2))
        mae = np.mean(np.abs(preds - y))
        self.assertLess(mae, 0.1)

    def test_hybrid_forecaster_bounds(self):
        seq = MarsDataAccess.generate_sol_sequence(start_ls_deg=20.0, num_sols=3, steps_per_sol=12)
        x_all, y_all, _ = MarsFeatureExtractor.build_dataset_from_sequences(seq, lead_steps=12)

        forecaster = MarsHybridForecaster(alpha=1.0)
        forecaster.fit(x_all, y_all)

        init_state = seq[0]
        feats = MarsFeatureExtractor.extract_features_for_grid(
            init_state, init_state["lats"], init_state["lons"]
        )
        preds = forecaster.predict_grid(feats, grid_shape=(36, 72))

        self.assertEqual(preds["pred_tsurf"].shape, (36, 72))
        self.assertEqual(preds["pred_wind_speed"].shape, (36, 72))
        self.assertEqual(preds["pred_dustcol"].shape, (36, 72))
        # Ensure clipping to physical bounds
        self.assertTrue(np.all(preds["pred_tsurf"] >= 130.0))
        self.assertTrue(np.all(preds["pred_tsurf"] <= 310.0))

    def test_evaluation_metrics(self):
        y_true = np.array([10.0, 20.0, 30.0], dtype=np.float32)
        y_pred = np.array([12.0, 19.0, 31.0], dtype=np.float32)

        m = ModelEvaluator.calculate_metrics(y_true, y_pred)
        self.assertAlmostEqual(m["mae"], 1.3333, places=3)
        self.assertGreater(m["pearson_r"], 0.95)


if __name__ == "__main__":
    unittest.main()
