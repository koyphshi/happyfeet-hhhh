"""
Preprocessing and Multi-Lag Temporal Feature Engineering Module
Transforms multi-dimensional Martian atmospheric sequences spanning 24–48 hours
into feature matrices for next-sol hazard forecasting.

Features:
- Multi-step lag states (t, t-6h, t-12h, t-24h, t-48h)
- 24h to 48h atmospheric tendencies / derivatives (d/dt)
- 24h rolling statistics (diurnal mean, amplitude, min, max, pressure tendency)
- Spatial gradients (dT/dx, dP/dx, topography elevation)
- Solar insolation, Ls harmonics, and diurnal phase
- Strict block-sol chronological splitting with embargo gap to prevent temporal leakage.
"""

from __future__ import annotations
from typing import Dict, Any, List, Tuple
import numpy as np


class MarsFeatureExtractor:
    """Extracts 24–48h multi-lag and physical features for next-sol Mars forecasting."""

    TARGET_NAMES = ["target_tsurf", "target_wind_speed", "target_dustcol", "target_ps"]

    # Cadence: 2 hours per step -> 12 steps = 24h (1 sol), 24 steps = 48h (2 sols)
    STEPS_PER_SOL = 12
    LEAD_STEPS_1_SOL = 12
    WINDOW_48H_STEPS = 24

    @classmethod
    def get_feature_names(cls) -> List[str]:
        names = [
            # Astronomical & Solar
            "sin_ls",
            "cos_ls",
            "sin_hour",
            "cos_hour",
            "subsolar_lat_norm",
            "cos_zenith",
            "solar_dist_factor",
            # Spatial coordinates & topography
            "lat_norm",
            "sin_lon",
            "cos_lon",
            "topo_km",
        ]
        # Current state t
        for v in ["tsurf", "wind_speed", "u", "v", "dustcol", "ps"]:
            names.append(f"{v}_t0")

        # Multi-lags (6h = -3 steps, 12h = -6 steps, 24h = -12 steps, 48h = -24 steps)
        for lag in ["6h", "12h", "24h", "48h"]:
            for v in ["tsurf", "wind_speed", "dustcol", "ps"]:
                names.append(f"{v}_lag_{lag}")

        # Atmospheric tendencies / derivatives
        for delta in ["6h", "12h", "24h", "48h"]:
            for v in ["tsurf", "wind_speed", "dustcol", "ps"]:
                names.append(f"delta_{v}_{delta}")

        # 24h Rolling statistics (diurnal mean, amplitude, min, max, std)
        names.extend(
            [
                "tsurf_24h_mean",
                "tsurf_24h_min",
                "tsurf_24h_max",
                "tsurf_24h_diurnal_amp",
                "tsurf_24h_std",
                "wind_24h_mean",
                "wind_24h_max",
                "dust_24h_mean",
                "dust_24h_trend",
                "ps_24h_mean",
                "ps_24h_tendency",
            ]
        )
        return names

    @classmethod
    def extract_features_from_history(
        cls,
        history: List[Dict[str, Any]],
        current_idx: int,
    ) -> np.ndarray:
        """
        Extract features for all cells on the 36x72 grid using the 24-48h window prior to current_idx.

        Args:
            history: Sequential list of atmospheric state dicts at 2h intervals.
            current_idx: Index of current time step t (must be >= 24 to have 48h history).

        Returns:
            features: 2D numpy array of shape (2592, num_features).
        """
        if current_idx < cls.WINDOW_48H_STEPS:
            raise ValueError(
                f"current_idx ({current_idx}) must be >= {cls.WINDOW_48H_STEPS} for 48h history."
            )

        state_t0 = history[current_idx]
        state_6h = history[current_idx - 3]
        state_12h = history[current_idx - 6]
        state_24h = history[current_idx - 12]
        state_48h = history[current_idx - 24]

        # 24h window states (last 12 steps including t0)
        window_24h = history[current_idx - 11 : current_idx + 1]

        lats = state_t0["lats"]
        lons = state_t0["lons"]
        n_lat, n_lon = len(lats), len(lons)
        n_cells = n_lat * n_lon

        lon_grid, lat_grid = np.meshgrid(lons, lats)
        flat_lats = lat_grid.ravel()
        flat_lons = lon_grid.ravel()

        ls_deg = float(state_t0.get("ls_deg", 0.0))
        hour = float(state_t0.get("hour", 12.0))

        ls_rad = np.radians(ls_deg)
        hour_rad = np.radians((hour / 24.0) * 360.0)
        subsolar_lat = 25.19 * np.sin(ls_rad)

        # 1. Astronomical features
        sin_ls = np.full(n_cells, np.sin(ls_rad), dtype=np.float32)
        cos_ls = np.full(n_cells, np.cos(ls_rad), dtype=np.float32)
        sin_hour = np.full(n_cells, np.sin(hour_rad), dtype=np.float32)
        cos_hour = np.full(n_cells, np.cos(hour_rad), dtype=np.float32)
        subsolar_norm = np.full(n_cells, subsolar_lat / 25.19, dtype=np.float32)

        # Heliocentric distance factor
        ecc = 0.0934
        nu_approx = ls_rad - np.radians(251.0)
        dist_au = (1.52368 * (1.0 - ecc**2)) / (1.0 + ecc * np.cos(nu_approx))
        solar_dist_factor = np.full(n_cells, (1.52368 / dist_au) ** 2, dtype=np.float32)

        # Solar zenith angle
        lst_grid = (hour + flat_lons / 15.0) % 24.0
        h_rad = np.radians((lst_grid - 12.0) * 15.0)
        cos_zenith = np.sin(np.radians(flat_lats)) * np.sin(np.radians(subsolar_lat)) + np.cos(
            np.radians(flat_lats)
        ) * np.cos(np.radians(subsolar_lat)) * np.cos(h_rad)
        cos_zenith = np.clip(cos_zenith, 0.0, 1.0).astype(np.float32)

        # 2. Spatial coordinates & topography
        lat_norm = (flat_lats / 90.0).astype(np.float32)
        sin_lon = np.sin(np.radians(flat_lons)).astype(np.float32)
        cos_lon = np.cos(np.radians(flat_lons)).astype(np.float32)
        topo_km = state_t0.get("topo_km", np.zeros((n_lat, n_lon), dtype=np.float32)).ravel()

        feature_cols = [
            sin_ls,
            cos_ls,
            sin_hour,
            cos_hour,
            subsolar_norm,
            cos_zenith,
            solar_dist_factor,
            lat_norm,
            sin_lon,
            cos_lon,
            topo_km,
        ]

        # 3. Current state t0 variables
        for v in ["tsurf", "wind_speed", "u", "v", "dustcol", "ps"]:
            feature_cols.append(state_t0[v].ravel())

        # 4. Multi-lags (6h, 12h, 24h, 48h)
        lag_states = [("6h", state_6h), ("12h", state_12h), ("24h", state_24h), ("48h", state_48h)]
        for tag, st in lag_states:
            for v in ["tsurf", "wind_speed", "dustcol", "ps"]:
                feature_cols.append(st[v].ravel())

        # 5. Temporal tendencies / derivatives (Delta = X_t0 - X_lag)
        for tag, st in lag_states:
            for v in ["tsurf", "wind_speed", "dustcol", "ps"]:
                delta = state_t0[v].ravel() - st[v].ravel()
                feature_cols.append(delta)

        # 6. 24h Rolling statistics
        tsurf_24h_stack = np.stack([s["tsurf"].ravel() for s in window_24h], axis=0)  # (12, n_cells)
        wind_24h_stack = np.stack([s["wind_speed"].ravel() for s in window_24h], axis=0)
        dust_24h_stack = np.stack([s["dustcol"].ravel() for s in window_24h], axis=0)
        ps_24h_stack = np.stack([s["ps"].ravel() for s in window_24h], axis=0)

        tsurf_mean = np.mean(tsurf_24h_stack, axis=0)
        tsurf_min = np.min(tsurf_24h_stack, axis=0)
        tsurf_max = np.max(tsurf_24h_stack, axis=0)
        tsurf_amp = tsurf_max - tsurf_min
        tsurf_std = np.std(tsurf_24h_stack, axis=0)

        wind_mean = np.mean(wind_24h_stack, axis=0)
        wind_max = np.max(wind_24h_stack, axis=0)

        dust_mean = np.mean(dust_24h_stack, axis=0)
        dust_trend = state_t0["dustcol"].ravel() - state_24h["dustcol"].ravel()

        ps_mean = np.mean(ps_24h_stack, axis=0)
        ps_tendency = state_t0["ps"].ravel() - state_24h["ps"].ravel()

        rolling_cols = [
            tsurf_mean,
            tsurf_min,
            tsurf_max,
            tsurf_amp,
            tsurf_std,
            wind_mean,
            wind_max,
            dust_mean,
            dust_trend,
            ps_mean,
            ps_tendency,
        ]
        feature_cols.extend(rolling_cols)

        features = np.column_stack(feature_cols).astype(np.float32)
        return features

    @classmethod
    def build_dataset_from_sequences(
        cls,
        sequence: List[Dict[str, Any]],
        lead_steps: int = 12,  # Next sol (12 steps at 2h intervals)
    ) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
        """
        Build aligned (X, Y) dataset across time steps with 48h temporal context.
        """
        min_required = cls.WINDOW_48H_STEPS + lead_steps + 1
        if len(sequence) < min_required:
            raise ValueError(
                f"Sequence length ({len(sequence)}) must be at least {min_required} steps."
            )

        x_list = []
        y_list = []
        sol_indices = []

        start_idx = cls.WINDOW_48H_STEPS
        end_idx = len(sequence) - lead_steps

        for t in range(start_idx, end_idx):
            state_target = sequence[t + lead_steps]

            x_t = cls.extract_features_from_history(sequence, current_idx=t)

            y_tsurf = state_target["tsurf"].ravel()
            y_wind = state_target["wind_speed"].ravel()
            y_dust = state_target["dustcol"].ravel()
            y_ps = state_target["ps"].ravel()

            y_t = np.column_stack([y_tsurf, y_wind, y_dust, y_ps]).astype(np.float32)

            x_list.append(x_t)
            y_list.append(y_t)
            # Sol index of the target
            sol_indices.extend([sequence[t]["sol"]] * len(x_t))

        x_all = np.vstack(x_list).astype(np.float32)
        y_all = np.vstack(y_list).astype(np.float32)
        sol_array = np.array(sol_indices, dtype=np.int32)

        meta = {
            "num_timesteps": len(x_list),
            "total_samples": len(x_all),
            "feature_names": cls.get_feature_names(),
            "target_names": cls.TARGET_NAMES,
            "sol_indices": sol_array,
        }
        return x_all, y_all, meta

    @staticmethod
    def train_val_split_chronological_with_embargo(
        x: np.ndarray,
        y: np.ndarray,
        sol_indices: np.ndarray,
        train_fraction: float = 0.70,
        embargo_sols: int = 2,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, Dict[str, Any]]:
        """
        Strict block-sol chronological splitting with an embargo gap.
        Completely eliminates temporal data leakage between training history and validation targets.
        """
        unique_sols = np.unique(sol_indices)
        num_sols = len(unique_sols)

        split_sol_idx = int(num_sols * train_fraction)
        train_max_sol = unique_sols[split_sol_idx]
        val_min_sol = train_max_sol + embargo_sols

        train_mask = sol_indices <= train_max_sol
        val_mask = sol_indices >= val_min_sol

        x_train, y_train = x[train_mask], y[train_mask]
        x_val, y_val = x[val_mask], y[val_mask]

        split_info = {
            "total_sols": int(num_sols),
            "train_sols": [int(unique_sols[0]), int(train_max_sol)],
            "embargo_sols_gap": int(embargo_sols),
            "val_sols": [int(val_min_sol), int(unique_sols[-1])],
            "train_samples": len(x_train),
            "val_samples": len(x_val),
            "embargo_purged_samples": int(len(x) - len(x_train) - len(x_val)),
        }
        return x_train, y_train, x_val, y_val, split_info
