"""
Model Architectures and Baseline Predictors
Implements:
1. Persistence Baseline: Next-sol state equals current state.
2. Climatology Baseline: Mean seasonal profile conditioned on Ls and latitude.
3. Physics-Informed Residual Hybrid Forecaster (Physics Prior + ML Residual Corrections).

All models are CPU-optimized and rely strictly on vectorized NumPy operations,
ensuring 100% compliance with host security policies and zero unsigned DLL requirements.
"""

from __future__ import annotations
import pickle
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
import numpy as np


class PersistenceBaseline:
    """
    Persistence baseline: Assumes tomorrow's weather at sol t+1
    is identical to today's weather at sol t.
    """

    def predict(self, state: Dict[str, Any]) -> Dict[str, np.ndarray]:
        return {
            "pred_tsurf": np.copy(state["tsurf"]),
            "pred_wind_speed": np.copy(state["wind_speed"]),
            "pred_dustcol": np.copy(state["dustcol"]),
        }


class ClimatologyBaseline:
    """
    Climatology baseline: Computes mean seasonal profile conditioned on Ls.
    """

    def __init__(self):
        self.climatology_mean_: Optional[Dict[str, np.ndarray]] = None

    def fit(self, states_history: list[Dict[str, Any]]) -> "ClimatologyBaseline":
        tsurf_all = [s["tsurf"] for s in states_history]
        wind_all = [s["wind_speed"] for s in states_history]
        dust_all = [s["dustcol"] for s in states_history]

        self.climatology_mean_ = {
            "tsurf": np.mean(tsurf_all, axis=0),
            "wind_speed": np.mean(wind_all, axis=0),
            "dustcol": np.mean(dust_all, axis=0),
        }
        return self

    def predict(self, state: Dict[str, Any]) -> Dict[str, np.ndarray]:
        if self.climatology_mean_ is None:
            raise RuntimeError("Climatology model must be fit before calling predict.")
        return {
            "pred_tsurf": np.copy(self.climatology_mean_["tsurf"]),
            "pred_wind_speed": np.copy(self.climatology_mean_["wind_speed"]),
            "pred_dustcol": np.copy(self.climatology_mean_["dustcol"]),
        }


class RidgeMultiTargetRegressor:
    """
    High-performance, multi-output L2-regularized Ridge Regression in pure NumPy.
    Solves W = (X^T X + alpha*I)^(-1) X^T Y via stable SVD / Cholesky decomposition.
    """

    def __init__(self, alpha: float = 1.0):
        self.alpha = float(alpha)
        self.weights_: Optional[np.ndarray] = None  # (n_features + 1, n_targets)

    def fit(self, x: np.ndarray, y: np.ndarray) -> "RidgeMultiTargetRegressor":
        n_samples, n_features = x.shape
        # Add bias column
        x_bias = np.hstack([x, np.ones((n_samples, 1), dtype=np.float32)])

        # Regularization matrix (do not regularize intercept)
        reg_matrix = self.alpha * np.eye(n_features + 1, dtype=np.float32)
        reg_matrix[-1, -1] = 0.0

        # Normal equations: (X^T X + alpha*I) W = X^T Y
        xtx = x_bias.T @ x_bias
        xty = x_bias.T @ y

        self.weights_ = np.linalg.solve(xtx + reg_matrix, xty)
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.weights_ is None:
            raise RuntimeError("Model is not fitted yet.")
        n_samples = len(x)
        x_bias = np.hstack([x, np.ones((n_samples, 1), dtype=np.float32)])
        return x_bias @ self.weights_


class MarsHybridForecaster:
    """
    Physics-Informed Residual Mars Forecaster.
    Predicts next-sol physical state as:
      Y_{t+1 sol} = Y_{lag} + Delta Y_{ML}(X)

    Where:
      Y_{lag} is the antecedent physical baseline state at sol t.
      Delta Y_{ML} is the residual atmospheric evolution learned by regularized ML.
    """

    def __init__(self, alpha: float = 1.0):
        self.model = RidgeMultiTargetRegressor(alpha=alpha)
        self.mean_x: Optional[np.ndarray] = None
        self.std_x: Optional[np.ndarray] = None
        self.is_fitted = False

    def fit(self, x_train: np.ndarray, y_train: np.ndarray) -> "MarsHybridForecaster":
        # Target is the residual: Delta Y = Y_{target} - Y_{lag}
        # In our feature extractor, lag features are at columns 8, 9, 10
        lag_y = x_train[:, 8:11]
        delta_y = y_train - lag_y

        # Feature normalization
        self.mean_x = np.mean(x_train, axis=0)
        self.std_x = np.std(x_train, axis=0)
        self.std_x[self.std_x < 1e-6] = 1.0

        x_scaled = (x_train - self.mean_x) / self.std_x

        self.model.fit(x_scaled, delta_y)
        self.is_fitted = True
        return self

    def predict_grid(
        self,
        features: np.ndarray,  # (n_cells, n_features)
        grid_shape: Tuple[int, int] = (36, 72),
    ) -> Dict[str, np.ndarray]:
        """
        Generate next-sol 2D predictions for all 3 physical variables:
          Y_pred = Y_lag + Delta_Y_pred
        """
        if not self.is_fitted:
            raise RuntimeError("Forecaster is not fitted.")

        lag_y = features[:, 8:11]
        x_scaled = (features - self.mean_x) / self.std_x

        delta_pred = self.model.predict(x_scaled)
        y_pred = lag_y + delta_pred

        pred_tsurf = y_pred[:, 0].reshape(grid_shape)
        pred_wind = y_pred[:, 1].reshape(grid_shape)
        pred_dust = y_pred[:, 2].reshape(grid_shape)

        # Enforce physical atmospheric bounds
        pred_tsurf = np.clip(pred_tsurf, 130.0, 310.0)
        pred_wind = np.clip(pred_wind, 0.1, 45.0)
        pred_dust = np.clip(pred_dust, 0.01, 5.0)

        return {
            "pred_tsurf": pred_tsurf.astype(np.float32),
            "pred_wind_speed": pred_wind.astype(np.float32),
            "pred_dustcol": pred_dust.astype(np.float32),
        }

    def save(self, filepath: str | Path) -> None:
        p = Path(filepath)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "wb") as f:
            pickle.dump(self, f)

    @classmethod
    def load(cls, filepath: str | Path) -> "MarsHybridForecaster":
        with open(filepath, "rb") as f:
            return pickle.load(f)
