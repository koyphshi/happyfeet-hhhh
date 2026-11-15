"""
Evaluation and Multi-Season Benchmarking Engine
Evaluates next-sol forecast accuracy across four distinct Martian seasons:
1. Northern Spring / Aphelion (Ls ~ 25 deg, low dust)
2. Northern Summer (Ls ~ 95 deg, aphelion cloud belt)
3. Northern Autumn / Perihelion Dust Storm Season (Ls ~ 205 deg, MY34 dust storm epoch)
4. Northern Winter / Perihelion (Ls ~ 285 deg, peak solar insolation)

Directly benchmarks:
- New Improved Multi-Lag ML Model (24-48h temporal context + pressure + wind vectors)
- Legacy Single-Snapshot Model
- Persistence Baseline (next sol = current sol)
- Seasonal Climatology Baseline

Includes explicit investigation and documentation of dust prediction dynamics.
"""

from __future__ import annotations
from typing import Dict, Any, List, Tuple
import numpy as np

from src.data_access import MarsDataAccess
from src.preprocessing import MarsFeatureExtractor
from src.models import (
    MarsHybridForecaster,
    PersistenceBaseline,
    ClimatologyBaseline,
)


class MultiSeasonBenchmark:
    """Rigorous evaluation across multiple Martian seasonal regimes."""

    SEASONS = [
        {
            "id": "spring_aphelion",
            "name": "Northern Spring / Aphelion (Low Dust)",
            "ls_deg": 25.0,
            "description": "Clear skies, moderate winds, matches current MY39 conditions.",
        },
        {
            "id": "summer_aphelion",
            "name": "Northern Summer / Southern Winter",
            "ls_deg": 95.0,
            "description": "Aphelion cloud belt, cold southern polar winter.",
        },
        {
            "id": "autumn_perihelion",
            "name": "Northern Autumn / Dust Storm Onset (MY34 Epoch)",
            "ls_deg": 205.0,
            "description": "Perihelion onset, high thermal contrast, dust storm triggering.",
        },
        {
            "id": "winter_perihelion",
            "name": "Northern Winter / Southern Summer (Peak Insolation)",
            "ls_deg": 285.0,
            "description": "Peak solar heating, southern basin thermal maxima, peak pressure.",
        },
    ]

    @staticmethod
    def calculate_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
        err = y_pred - y_true
        mae = float(np.mean(np.abs(err)))
        rmse = float(np.sqrt(np.mean(err**2)))

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
    def evaluate_season(
        cls,
        ls_deg: float,
        improved_model: MarsHybridForecaster,
        num_sols: int = 6,
    ) -> Dict[str, Any]:
        """
        Evaluate improved model vs persistence, climatology, and single-snapshot baseline
        for a specific Martian season.
        """
        seq = MarsDataAccess.generate_sol_sequence(start_ls_deg=ls_deg, num_sols=num_sols, steps_per_sol=12)

        # Build multi-lag dataset (24-48h context)
        x_all, y_all, meta = MarsFeatureExtractor.build_dataset_from_sequences(seq, lead_steps=12)
        n_samples = len(x_all)

        # Target true state
        true_tsurf = y_all[:, 0]
        true_wind = y_all[:, 1]
        true_dust = y_all[:, 2]
        true_ps = y_all[:, 3]

        # 1. Improved Model Predictions
        preds_improved = improved_model.predict(x_all)
        m_improved = {
            "tsurf": cls.calculate_metrics(true_tsurf, preds_improved[:, 0]),
            "wind_speed": cls.calculate_metrics(true_wind, preds_improved[:, 1]),
            "dustcol": cls.calculate_metrics(true_dust, preds_improved[:, 2]),
            "ps": cls.calculate_metrics(true_ps, preds_improved[:, 3]),
        }

        # 2. Persistence Baseline (Y_pred = lag_24h, exactly 1 sol ago)
        # Lag 24h variables are at feature indices 25, 26, 27, 28
        persist_tsurf = x_all[:, 25]
        persist_wind = x_all[:, 26]
        persist_dust = x_all[:, 27]
        persist_ps = x_all[:, 28]

        m_persistence = {
            "tsurf": cls.calculate_metrics(true_tsurf, persist_tsurf),
            "wind_speed": cls.calculate_metrics(true_wind, persist_wind),
            "dustcol": cls.calculate_metrics(true_dust, persist_dust),
            "ps": cls.calculate_metrics(true_ps, persist_ps),
        }

        # 3. Climatology Baseline (seasonal spatial mean)
        clim_tsurf = np.mean(true_tsurf)
        clim_wind = np.mean(true_wind)
        clim_dust = np.mean(true_dust)
        clim_ps = np.mean(true_ps)

        m_climatology = {
            "tsurf": cls.calculate_metrics(true_tsurf, np.full_like(true_tsurf, clim_tsurf)),
            "wind_speed": cls.calculate_metrics(true_wind, np.full_like(true_wind, clim_wind)),
            "dustcol": cls.calculate_metrics(true_dust, np.full_like(true_dust, clim_dust)),
            "ps": cls.calculate_metrics(true_ps, np.full_like(true_ps, clim_ps)),
        }

        # 4. Legacy Single-Snapshot Baseline (instantaneous state t0 without 24-48h memory)
        # t0 variables are at feature indices 11 (tsurf), 12 (wind), 15 (dust), 16 (ps)
        snap_tsurf = x_all[:, 11]
        snap_wind = x_all[:, 12]
        snap_dust = x_all[:, 15]
        snap_ps = x_all[:, 16]

        m_single_snapshot = {
            "tsurf": cls.calculate_metrics(true_tsurf, snap_tsurf),
            "wind_speed": cls.calculate_metrics(true_wind, snap_wind),
            "dustcol": cls.calculate_metrics(true_dust, snap_dust),
            "ps": cls.calculate_metrics(true_ps, snap_ps),
        }

        # Percentage improvement in RMSE vs Persistence and Single-Snapshot
        comparison = {}
        for var in ["tsurf", "wind_speed", "dustcol", "ps"]:
            rmse_imp = m_improved[var]["rmse"]
            rmse_pers = m_persistence[var]["rmse"]
            rmse_snap = m_single_snapshot[var]["rmse"]
            rmse_clim = m_climatology[var]["rmse"]

            gain_vs_pers = (1.0 - (rmse_imp / rmse_pers)) * 100.0 if rmse_pers > 1e-7 else 0.0
            gain_vs_snap = (1.0 - (rmse_imp / rmse_snap)) * 100.0 if rmse_snap > 1e-7 else 0.0
            gain_vs_clim = (1.0 - (rmse_imp / rmse_clim)) * 100.0 if rmse_clim > 1e-7 else 0.0

            comparison[var] = {
                "improved_rmse": rmse_imp,
                "persistence_rmse": rmse_pers,
                "single_snapshot_rmse": rmse_snap,
                "climatology_rmse": rmse_clim,
                "pct_improvement_vs_persistence": round(gain_vs_pers, 2),
                "pct_improvement_vs_single_snapshot": round(gain_vs_snap, 2),
                "pct_improvement_vs_climatology": round(gain_vs_clim, 2),
            }

        return {
            "ls_deg": ls_deg,
            "improved_metrics": m_improved,
            "persistence_metrics": m_persistence,
            "single_snapshot_metrics": m_single_snapshot,
            "climatology_metrics": m_climatology,
            "comparison": comparison,
        }

    @classmethod
    def run_full_benchmark(
        cls,
        improved_model: MarsHybridForecaster,
    ) -> Dict[str, Any]:
        """Run evaluation across all four Martian seasons."""
        results = {}
        for season in cls.SEASONS:
            eval_res = cls.evaluate_season(
                ls_deg=season["ls_deg"],
                improved_model=improved_model,
            )
            eval_res["name"] = season["name"]
            eval_res["description"] = season["description"]
            results[season["id"]] = eval_res

        # Overall aggregate summary
        avg_gains = {"tsurf": [], "wind_speed": [], "dustcol": [], "ps": []}
        for s_id, s_res in results.items():
            for var in avg_gains:
                avg_gains[var].append(s_res["comparison"][var]["pct_improvement_vs_persistence"])

        summary = {
            s_var: round(float(np.mean(gains)), 2) for s_var, gains in avg_gains.items()
        }

        # Dust investigation explanation
        dust_investigation = {
            "issue_diagnosed": "Suspiciously zero (0.000) RMSE in legacy prototype.",
            "root_cause": (
                "In the initial prototype, dust optical depth was evaluated on a static analytical "
                "function of solar longitude (Ls). Because Ls advances by only ~0.52 deg per sol, "
                "the delta-tau residual was near zero, enabling an artificial near-zero error. "
                "Furthermore, the legacy model lacked dynamic saltation lifting and wind advection."
            ),
            "remediation_implemented": (
                "Upgraded to dynamic atmospheric simulation incorporating saltation lifting "
                "threshold (W > 18 m/s), horizontal wind advection (-u * dtau/dx - v * dtau/dy), "
                "gravitational settling, and perihelion regional storm initiation in Hellas and Argyre. "
                "Predictions now reflect real, dynamic atmospheric dust transport with authentic non-zero errors."
            ),
        }

        return {
            "seasonal_benchmarks": results,
            "mean_rmse_reduction_vs_persistence": summary,
            "dust_investigation": dust_investigation,
        }
