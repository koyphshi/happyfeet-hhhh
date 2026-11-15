"""
Forecast Orchestrator and Pipeline Runner
Executes end-to-end next-sol hazard forecasting in two modes:
1. Current Martian Date Forecast (Mode: 'current')
2. Historical Simulation & Evaluation (Mode: 'historical')
"""

from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional
import yaml
import numpy as np

from src.mars_time import MarsTimeEngine, get_current_martian_date
from src.hazard_scores import compute_all_hazard_rasters, get_threshold_documentation
from src.data_access import MarsDataAccess
from src.preprocessing import MarsFeatureExtractor, SimpleStandardScaler
from src.models import (
    MarsHybridForecaster,
    PersistenceBaseline,
    ClimatologyBaseline,
)
from src.evaluation import ModelEvaluator
from src.geotiff_export import export_hazard_geotiff, export_metadata_json


class MarsForecastRunner:
    """End-to-end forecast orchestration and export engine."""

    def __init__(self, config_path: Optional[str | Path] = None):
        self.forecast_root = Path(__file__).resolve().parent.parent
        if config_path is None:
            config_path = self.forecast_root / "config" / "default_config.yaml"
        self.config_path = Path(config_path)

        with open(self.config_path, "r", encoding="utf-8") as f:
            self.config = yaml.safe_load(f)

        self.models_dir = self.forecast_root / "models"
        self.outputs_dir = self.forecast_root / self.config["output"]["geotiff_dir"]
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

        self.model_checkpoint = self.models_dir / "mars_hybrid_forecaster.pkl"

    def get_or_train_model(self) -> MarsHybridForecaster:
        """Load trained model from disk, or train on physical sol sequence if not cached."""
        if self.model_checkpoint.exists():
            return MarsHybridForecaster.load(self.model_checkpoint)

        # Train on a representative multi-sol seasonal sequence (15 sols at 2-hr intervals = 180 states)
        sequence = MarsDataAccess.generate_sol_sequence(
            start_ls_deg=10.0,
            num_sols=15,
            steps_per_sol=12,
        )
        x_all, y_all, _ = MarsFeatureExtractor.build_dataset_from_sequences(sequence, lead_steps=12)
        x_train, y_train, _, _ = MarsFeatureExtractor.train_val_split_temporal(x_all, y_all, train_fraction=0.8)

        forecaster = MarsHybridForecaster(alpha=2.0)
        forecaster.fit(x_train, y_train)
        forecaster.save(self.model_checkpoint)
        return forecaster

    def run_current_forecast(self, lon_range: str = "180") -> Dict[str, Any]:
        """
        Mode 1: Generate next-sol forecast for current Martian date.
        """
        now_utc = datetime.now(timezone.utc)
        ephem = MarsTimeEngine.calculate_ephemeris(now_utc)
        current_ls = ephem["ls_deg"]

        # 1. Initialize atmospheric state for current Ls
        init_state = MarsDataAccess.generate_synthetic_physical_state(
            ls_deg=current_ls,
            sol_time_hours=ephem["mtc_hours"],
        )
        init_state["ls_deg"] = current_ls
        init_state["hour"] = ephem["mtc_hours"]

        # 2. Extract features and predict next-sol state
        forecaster = self.get_or_train_model()
        features = MarsFeatureExtractor.extract_features_for_grid(
            init_state, init_state["lats"], init_state["lons"]
        )
        preds = forecaster.predict_grid(features, grid_shape=(36, 72))

        # 3. Compute 6-band hazard rasters
        hazard_rasters = compute_all_hazard_rasters(
            tsurf=preds["pred_tsurf"],
            wind_speed=preds["pred_wind_speed"],
            dustcol=preds["pred_dustcol"],
        )

        # 4. Export GeoTIFF
        date_str = now_utc.strftime("%Y%m%d_%H%M%S")
        tif_filename = f"mars_hazard_forecast_current_{date_str}.tif"
        tif_path = self.outputs_dir / tif_filename
        latest_symlink = self.outputs_dir / "mars_hazard_forecast_latest.tif"

        export_hazard_geotiff(
            hazard_rasters=hazard_rasters,
            output_path=tif_path,
            lon_range=lon_range,
            metadata_extra={
                "forecast_mode": "current_date",
                "mars_year": ephem["mars_year"],
                "ls_deg": ephem["ls_deg"],
                "msd": ephem["msd"],
            },
        )
        # Also copy/save as latest
        export_hazard_geotiff(
            hazard_rasters=hazard_rasters,
            output_path=latest_symlink,
            lon_range=lon_range,
        )

        # 5. Export metadata JSON
        meta = {
            "pipeline": "Mars Weather Hazard Forecasting Pipeline",
            "version": self.config["project"]["version"],
            "forecast_mode": "current_martian_date",
            "forecast_initialization": {
                "earth_utc": ephem["utc_iso"],
                "mars_year": ephem["mars_year"],
                "solar_longitude_ls_deg": ephem["ls_deg"],
                "mars_sol_date_msd": ephem["msd"],
                "coordinated_mars_time_mtc": ephem["mtc_formatted"],
                "season": ephem["season"],
                "heliocentric_distance_au": ephem["heliocentric_distance_au"],
            },
            "forecast_target": {
                "lead_time": "1 Martian Sol (approximately 24 hours 39 minutes)",
                "target_msd": round(ephem["msd"] + 1.0, 4),
                "target_ls_deg": round((ephem["ls_deg"] + 0.524) % 360.0, 3),
            },
            "model_provenance": {
                "architecture": "Physics-Informed Multi-Target Residual ML Forecaster",
                "training_basis": "NASA Legacy MGCM & OpenMARS Physical Dynamics",
                "features_used": MarsFeatureExtractor.FEATURE_NAMES,
            },
            "raster_specifications": {
                "file": tif_filename,
                "latest_alias": "mars_hazard_forecast_latest.tif",
                "crs": self.config["grid"]["crs"],
                "proj4": self.config["grid"]["proj4"],
                "dimensions": [36, 72],
                "resolution_deg": self.config["grid"]["resolution_deg"],
                "bands": self.config["output"]["bands"],
            },
            "scientific_disclosures": {
                "status": "decision_support_research_model",
                "disclaimer": (
                    "This is a demonstration decision-support forecast. It is NOT certified "
                    "for astronaut mission-critical life-support operations. Current-date forecasts "
                    "are simulation-conditioned estimates using astronomical ephemeris and physical "
                    "climate simulation priors."
                ),
                "thresholds": get_threshold_documentation(),
            },
        }

        json_path = self.outputs_dir / f"mars_hazard_forecast_current_{date_str}.json"
        latest_json = self.outputs_dir / "mars_hazard_forecast_latest.json"
        export_metadata_json(meta, json_path)
        export_metadata_json(meta, latest_json)

        return {
            "status": "success",
            "mode": "current",
            "geotiff_path": str(tif_path),
            "metadata_path": str(json_path),
            "ephemeris": ephem,
        }

    def run_historical_forecast(
        self,
        date_str: str,
        lon_range: str = "180",
    ) -> Dict[str, Any]:
        """
        Mode 2: Generate forecast and evaluate against baseline for historical date.
        """
        dt = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        ephem = MarsTimeEngine.calculate_ephemeris(dt)
        init_ls = ephem["ls_deg"]

        # Generate sequence to simulate ground truth comparison
        sequence = MarsDataAccess.generate_sol_sequence(start_ls_deg=init_ls, num_sols=3, steps_per_sol=12)
        init_state = sequence[0]
        true_next_sol = sequence[12]  # Sol t+1

        # Predict with model
        forecaster = self.get_or_train_model()
        features = MarsFeatureExtractor.extract_features_for_grid(
            init_state, init_state["lats"], init_state["lons"]
        )
        preds = forecaster.predict_grid(features, grid_shape=(36, 72))

        # Baselines
        persistence = PersistenceBaseline()
        pred_p = persistence.predict(init_state)

        climatology = ClimatologyBaseline()
        climatology.fit(sequence[:12])
        pred_c = climatology.predict(init_state)

        # Evaluate
        eval_model = ModelEvaluator.evaluate_forecast(true_next_sol, preds)
        eval_p = ModelEvaluator.evaluate_forecast(true_next_sol, pred_p)
        eval_c = ModelEvaluator.evaluate_forecast(true_next_sol, pred_c)
        comparison = ModelEvaluator.compare_against_baselines(eval_model, eval_p, eval_c)

        # Hazard Rasters
        hazard_rasters = compute_all_hazard_rasters(
            tsurf=preds["pred_tsurf"],
            wind_speed=preds["pred_wind_speed"],
            dustcol=preds["pred_dustcol"],
        )

        safe_date = date_str.replace(":", "-").replace(" ", "_")
        tif_filename = f"mars_hazard_forecast_historical_{safe_date}.tif"
        tif_path = self.outputs_dir / tif_filename
        export_hazard_geotiff(
            hazard_rasters=hazard_rasters,
            output_path=tif_path,
            lon_range=lon_range,
        )

        meta = {
            "forecast_mode": "historical_validation",
            "historical_date": ephem,
            "metrics": {
                "model_accuracy": eval_model,
                "persistence_accuracy": eval_p,
                "climatology_accuracy": eval_c,
                "baseline_comparison": comparison,
            },
            "disclaimer": "Validated on historical Mars atmospheric simulation.",
        }
        json_path = self.outputs_dir / f"mars_hazard_forecast_historical_{safe_date}.json"
        export_metadata_json(meta, json_path)

        return {
            "status": "success",
            "mode": "historical",
            "geotiff_path": str(tif_path),
            "metadata_path": str(json_path),
            "ephemeris": ephem,
            "comparison": comparison,
        }
