#!/usr/bin/env python3
"""
CLI Entry Point: Mars Weather Hazard Forecast Generator
Executes next-sol hazard forecasting across the surface of Mars.

Usage:
  # Mode 1: Forecast for Current Martian Date
  python scripts/generate_forecast.py --mode current

  # Mode 2: Historical Simulation & Validation
  python scripts/generate_forecast.py --mode historical --date 2018-06-15
"""

import sys
import argparse
from pathlib import Path

# Add forecast directory to sys.path
forecast_root = Path(__file__).resolve().parent.parent
if str(forecast_root) not in sys.path:
    sys.path.insert(0, str(forecast_root))

from src.forecast_runner import MarsForecastRunner


def save_forecast_preview_plot(tif_path: str):
    """Generate a multi-panel visual preview of the forecast bands."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
        import struct

        # Read TIFF raw pixels directly using TIFF header offsets
        with open(tif_path, "rb") as f:
            data = f.read()

        # Extract StripOffsets (tag 273)
        num_tags = struct.unpack_from("<H", data, 8)[0]
        strip_offset = None
        for i in range(num_tags):
            tag_id, _, _, val_offset = struct.unpack_from("<HHII", data, 10 + i * 12)
            if tag_id == 273:
                strip_offset = val_offset
                break

        if strip_offset is None:
            return

        # 6 bands * 36 lat * 72 lon float32
        pixels = np.frombuffer(data[strip_offset : strip_offset + 6 * 36 * 72 * 4], dtype="<f4")
        stack = pixels.reshape((6, 36, 72))

        band_titles = [
            ("Band 1: Dust Hazard Risk", "YlOrRd"),
            ("Band 2: Wind Hazard Risk", "Blues"),
            ("Band 3: Extreme Cold Risk", "coolwarm_r"),
            ("Band 4: Extreme Heat Risk", "inferno"),
            ("Band 5: Overall Risk Score", "RdYlGn_r"),
            ("Band 6: Model Uncertainty", "Purples"),
        ]

        fig, axes = plt.subplots(2, 3, figsize=(14, 7), sharex=True, sharey=True)
        fig.suptitle("Mars Environmental Hazard Forecast (Next Martian Sol)", fontsize=14, weight="bold")

        extent = [-180, 180, -90, 90]
        for idx, (title, cmap) in enumerate(band_titles):
            ax = axes.flat[idx]
            im = ax.imshow(stack[idx], origin="upper", extent=extent, cmap=cmap, vmin=0.0, vmax=1.0)
            ax.set_title(title, fontsize=10, weight="bold")
            ax.set_xlabel("Longitude (deg E)")
            ax.set_ylabel("Latitude (deg N)")
            plt.colorbar(im, ax=ax, orientation="horizontal", pad=0.15, shrink=0.8, label="Risk [0-1]")

        plt.tight_layout()
        png_path = Path(tif_path).with_suffix(".png")
        fig.savefig(png_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        print(f" Preview PNG:      {png_path}")
    except Exception as e:
        print(f"[-] Preview plot generation skipped: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate Mars-wide Environmental Hazard Forecast (Next Martian Sol)."
    )
    parser.add_argument(
        "--mode",
        choices=["current", "historical"],
        default="current",
        help="Forecasting mode: 'current' (current Earth/Mars date) or 'historical' (validation).",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Historical Earth UTC date in YYYY-MM-DD or ISO format (required for --mode historical).",
    )
    parser.add_argument(
        "--lon-range",
        choices=["180", "360"],
        default="180",
        help="Longitude coordinates bounds: '180' for [-180, 180] (CesiumJS standard) or '360' for [0, 360].",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to custom YAML configuration file.",
    )

    parser.add_argument(
        "--plot",
        action="store_true",
        help="Generate a 6-panel PNG preview of the forecasted hazard maps.",
    )

    args = parser.parse_args()

    print("=" * 70)
    print("      MARS ENVIRONMENTAL HAZARD FORECASTING PIPELINE (ML/GCM)      ")
    print("=" * 70)

    runner = MarsForecastRunner(config_path=args.config)

    if args.mode == "current":
        print("[*] Running Mode 1: Current Martian Date Forecast...")
        result = runner.run_current_forecast(lon_range=args.lon_range)
        ephem = result["ephemeris"]

        print("\n--- Martian Astronomical Ephemeris ---")
        print(f" Earth UTC:        {ephem['utc_iso']}")
        print(f" Mars Year:        MY {ephem['mars_year']}")
        print(f" Solar Longitude:  Ls = {ephem['ls_deg']:.2f}°")
        print(f" Mars Sol Date:    MSD {ephem['msd']:.2f}")
        print(f" Coordinated Mars: MTC {ephem['mtc_formatted']}")
        print(f" Season:           {ephem['season']}")
        print(f" Solar Distance:   {ephem['heliocentric_distance_au']:.4f} AU")

        print("\n--- Generated Forecast Layers ---")
        print(f" GeoTIFF (6-Band): {result['geotiff_path']}")
        print(f" Metadata JSON:    {result['metadata_path']}")
        print("\nRaster Bands:")
        print("  Band 1: Dust Hazard Risk   [0.0 - 1.0]")
        print("  Band 2: Wind Hazard Risk   [0.0 - 1.0]")
        print("  Band 3: Extreme Cold Risk  [0.0 - 1.0]")
        print("  Band 4: Extreme Heat Risk  [0.0 - 1.0]")
        print("  Band 5: Overall Risk Score [0.0 - 1.0]")
        print("  Band 6: Model Uncertainty  [0.0 - 1.0]")

        if args.plot:
            save_forecast_preview_plot(result["geotiff_path"])
        print("\n[+] Forecast generation complete.")

    elif args.mode == "historical":
        if not args.date:
            print("[-] Error: --date is required when running in historical mode (e.g. --date 2018-06-15)")
            sys.exit(1)

        print(f"[*] Running Mode 2: Historical Simulation & Validation for date {args.date}...")
        result = runner.run_historical_forecast(date_str=args.date, lon_range=args.lon_range)
        ephem = result["ephemeris"]
        comparison = result["comparison"]

        print("\n--- Historical Ephemeris ---")
        print(f" Mars Year:        MY {ephem['mars_year']}")
        print(f" Solar Longitude:  Ls = {ephem['ls_deg']:.2f}°")
        print(f" Season:           {ephem['season']}")

        print("\n--- Baseline Comparison (RMSE Reduction) ---")
        print(f"{'Variable':<15} {'Model RMSE':<12} {'Persistence':<14} {'Climatology':<14} {'Imp vs Persist':<16}")
        print("-" * 72)
        for var, m in comparison.items():
            print(
                f"{var:<15} {m['model_rmse']:<12.3f} {m['persistence_rmse']:<14.3f} "
                f"{m['climatology_rmse']:<14.3f} {m['pct_improvement_vs_persistence']:+.1f}%"
            )

        print(f"\n[+] Validation GeoTIFF saved: {result['geotiff_path']}")
        print(f"[+] Validation JSON saved:    {result['metadata_path']}")


if __name__ == "__main__":
    main()
