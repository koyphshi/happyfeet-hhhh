"""
Preprocessing and Feature Engineering Module
Transforms multi-dimensional Martian atmospheric and surface time series into
aligned feature and target matrices for next-sol hazard forecasting.

Strict design principles:
- Temporal order preservation: Strict time-series train/validation split to avoid data leakage.
- Physical astronomical features: Solar longitude (Ls), diurnal hour angles, and insolation geometry.
- Vectorized NumPy implementations for high CPU efficiency and low memory consumption.
"""

from __future__ import annotations
from typing import Dict, Any, List, Tuple
import numpy as np


class MarsFeatureExtractor:
    """Extracts physical and astronomical features for next-sol Mars weather forecasting."""

    FEATURE_NAMES = [
        "sin_ls",
        "cos_ls",
        "sin_hour",
        "cos_hour",
        "lat_norm",
        "sin_lon",
        "cos_lon",
        "cos_zenith_proxy",
        "lag_tsurf",
        "lag_wind_speed",
        "lag_dustcol",
    ]

    TARGET_NAMES = ["target_tsurf", "target_wind_speed", "target_dustcol"]

    @classmethod
    def extract_features_for_grid(
        cls,
        state: Dict[str, Any],
        lats: np.ndarray,
        lons: np.ndarray,
    ) -> np.ndarray:
        """
        Extract feature vector for each cell in the 2D grid.

        Returns:
            X: Array of shape (n_lat * n_lon, n_features)
        """
        n_lat = len(lats)
        n_lon = len(lons)
        n_cells = n_lat * n_lon

        lon_grid, lat_grid = np.meshgrid(lons, lats)
        flat_lats = lat_grid.ravel()
        flat_lons = lon_grid.ravel()

        ls_deg = float(state.get("ls_deg", 0.0))
        hour = float(state.get("hour", 12.0))

        ls_rad = np.radians(ls_deg)
        hour_rad = np.radians((hour / 24.0) * 360.0)

        sin_ls = np.full(n_cells, np.sin(ls_rad), dtype=np.float32)
        cos_ls = np.full(n_cells, np.cos(ls_rad), dtype=np.float32)

        sin_hour = np.full(n_cells, np.sin(hour_rad), dtype=np.float32)
        cos_hour = np.full(n_cells, np.cos(hour_rad), dtype=np.float32)

        lat_norm = (flat_lats / 90.0).astype(np.float32)
        lon_rad = np.radians(flat_lons)
        sin_lon = np.sin(lon_rad).astype(np.float32)
        cos_lon = np.cos(lon_rad).astype(np.float32)

        # Solar zenith angle proxy:
        subsolar_lat_rad = np.radians(25.19 * np.sin(ls_rad))
        lst_grid = (hour + flat_lons / 15.0) % 24.0
        h_rad = np.radians((lst_grid - 12.0) * 15.0)
        cos_zenith = np.sin(np.radians(flat_lats)) * np.sin(subsolar_lat_rad) + np.cos(
            np.radians(flat_lats)
        ) * np.cos(subsolar_lat_rad) * np.cos(h_rad)
        cos_zenith = np.clip(cos_zenith, 0.0, 1.0).astype(np.float32)

        lag_tsurf = state["tsurf"].ravel()
        lag_wind = state["wind_speed"].ravel()
        lag_dust = state["dustcol"].ravel()

        features = np.column_stack(
            [
                sin_ls,
                cos_ls,
                sin_hour,
                cos_hour,
                lat_norm,
                sin_lon,
                cos_lon,
                cos_zenith,
                lag_tsurf,
                lag_wind,
                lag_dust,
            ]
        )
        return features.astype(np.float32)

    @classmethod
    def build_dataset_from_sequences(
        cls,
        sequence: List[Dict[str, Any]],
        lead_steps: int = 12,  # 1 sol lead time (12 steps at 2-hour cadence)
    ) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
        """
        Build (X, Y) training arrays from sequential time steps.

        Target is the physical state lead_steps ahead:
          Y = [tsurf_{t+lead}, wind_speed_{t+lead}, dustcol_{t+lead}]
        """
        if len(sequence) <= lead_steps:
            raise ValueError(
                f"Sequence length ({len(sequence)}) must be greater than lead_steps ({lead_steps})"
            )

        lats = sequence[0]["lats"]
        lons = sequence[0]["lons"]
        n_cells = len(lats) * len(lons)

        x_list = []
        y_list = []

        for t in range(len(sequence) - lead_steps):
            current_state = sequence[t]
            target_state = sequence[t + lead_steps]

            x_step = cls.extract_features_for_grid(current_state, lats, lons)
            y_tsurf = target_state["tsurf"].ravel()
            y_wind = target_state["wind_speed"].ravel()
            y_dust = target_state["dustcol"].ravel()

            y_step = np.column_stack([y_tsurf, y_wind, y_dust])

            x_list.append(x_step)
            y_list.append(y_step)

        x_all = np.vstack(x_list).astype(np.float32)
        y_all = np.vstack(y_list).astype(np.float32)

        meta = {
            "num_pairs": len(x_list),
            "total_samples": len(x_all),
            "lead_steps": lead_steps,
            "feature_names": cls.FEATURE_NAMES,
            "target_names": cls.TARGET_NAMES,
        }
        return x_all, y_all, meta

    @staticmethod
    def train_val_split_temporal(
        x: np.ndarray,
        y: np.ndarray,
        train_fraction: float = 0.75,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Perform strict chronological split on sequential dataset.
        Prevents lookahead bias / data leakage.
        """
        n_samples = len(x)
        split_idx = int(n_samples * train_fraction)

        x_train, y_train = x[:split_idx], y[:split_idx]
        x_val, y_val = x[split_idx:], y[split_idx:]
        return x_train, y_train, x_val, y_val


class SimpleStandardScaler:
    """Pure NumPy implementation of standard z-score normalization."""

    def __init__(self):
        self.mean_ = None
        self.std_ = None

    def fit(self, x: np.ndarray) -> "SimpleStandardScaler":
        self.mean_ = np.mean(x, axis=0)
        self.std_ = np.std(x, axis=0)
        # Avoid division by zero
        self.std_[self.std_ < 1e-7] = 1.0
        return self

    def transform(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean_) / self.std_

    def fit_transform(self, x: np.ndarray) -> np.ndarray:
        self.fit(x)
        return self.transform(x)

    def inverse_transform(self, x: np.ndarray) -> np.ndarray:
        return (x * self.std_) + self.mean_
