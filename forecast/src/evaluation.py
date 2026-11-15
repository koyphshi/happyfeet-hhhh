"""
Evaluation and Validation Metrics Module
Evaluates physical weather variable accuracy and hazard risk classification performance
against standard baselines (Persistence and Climatology).
"""

from __future__ import annotations
from typing import Dict, Any, List
import numpy as np


class ModelEvaluator:
    """Calculates scientific evaluation metrics across physical variables and risk scores."""

    @staticmethod
    def calculate_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
        """
        Compute standard regression metrics: MAE, RMSE, Pearson r.
        """
        err = y_pred - y_true
        mae = float(np.mean(np.abs(err)))
        rmse = float(np.sqrt(np.mean(err**2)))

        # Pearson correlation
        y_true_centered = y_true - np.mean(y_true)
        y_pred_centered = y_pred - np.mean(y_pred)
        norm_prod = np.sqrt(np.sum(y_true_centered**2) * np.sum(y_pred_centered**2))
        r = float(np.sum(y_true_centered * y_pred_centered) / norm_prod) if norm_prod > 1e-9 else 0.0

        return {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "pearson_r": round(r, 4),
        }

    @classmethod
    def evaluate_forecast(
        cls,
        true_state: Dict[str, np.ndarray],
        pred_state: Dict[str, np.ndarray],
    ) -> Dict[str, Any]:
        """
        Evaluate full multi-target physical predictions.
        """
        results = {}
        vars_map = [
            ("tsurf", "pred_tsurf", "Kelvin"),
            ("wind_speed", "pred_wind_speed", "m/s"),
            ("dustcol", "pred_dustcol", "tau"),
        ]

        for true_key, pred_key, unit in vars_map:
            y_t = true_state[true_key].ravel()
            y_p = pred_state[pred_key].ravel()
            metrics = cls.calculate_metrics(y_t, y_p)
            metrics["unit"] = unit
            results[true_key] = metrics

        return results

    @classmethod
    def compare_against_baselines(
        cls,
        model_metrics: Dict[str, Any],
        persistence_metrics: Dict[str, Any],
        climatology_metrics: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Compute percentage improvement of the model over baselines:
          Improvement (%) = (1.0 - RMSE_model / RMSE_baseline) * 100
        """
        comparison = {}
        for var_name in ["tsurf", "wind_speed", "dustcol"]:
            rmse_m = model_metrics[var_name]["rmse"]
            rmse_p = persistence_metrics[var_name]["rmse"]
            rmse_c = climatology_metrics[var_name]["rmse"]

            imp_vs_p = (1.0 - (rmse_m / rmse_p)) * 100.0 if rmse_p > 1e-7 else 0.0
            imp_vs_c = (1.0 - (rmse_m / rmse_c)) * 100.0 if rmse_c > 1e-7 else 0.0

            comparison[var_name] = {
                "model_rmse": rmse_m,
                "persistence_rmse": rmse_p,
                "climatology_rmse": rmse_c,
                "pct_improvement_vs_persistence": round(imp_vs_p, 2),
                "pct_improvement_vs_climatology": round(imp_vs_c, 2),
            }

        return comparison
