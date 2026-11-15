# Mars Environmental Hazard Forecasting Pipeline

A standalone, physics-informed machine-learning decision-support pipeline for predicting surface and atmospheric environmental hazards across Mars for approximately the next Martian sol (1 sol = 24 hours, 39 minutes).

Designed to run on standard CPU architectures with minimal data downloads, streaming remote access, and zero external binary C-dependencies.

---

## 1. Architecture Overview

```
                      +-----------------------------+
                      |   Current Earth UTC Date    |
                      +--------------+--------------+
                                     |
                                     v
                      +-----------------------------+
                      | Mars24 Astronomical Engine  |
                      |   (Allison & McEwen 2000)   |
                      |  -> MSD, Ls, Mars Year, MTC |
                      +--------------+--------------+
                                     |
                                     v
+------------------------+    +-----------------------------+    +-------------------------+
| NASA MGCM Simulations  |    |  Antecedent Physical State  |    |  OpenMARS Observations  |
|  (Time-evolving GCM)   |--->|    X(t) at current Ls, hour |--->| (ARCO-Zarr Remote Chunks|
+------------------------+    +--------------+--------------+    +-------------------------+
                                             |
                                             v
                              +-----------------------------+
                              |   Physics-Informed Hybrid   |
                              |   Residual ML Forecaster    |
                              |   Y(t+1sol) = Y(t) + dY(ML) |
                              +--------------+--------------+
                                             |
                                             v
                              +-----------------------------+
                              | Hazard Risk Engine [0..1]   |
                              | - Dust (Montabone et al.)   |
                              | - Wind (Greeley et al.)     |
                              | - Cold (Kieffer et al.)     |
                              | - Heat (MSL/Perseverance)   |
                              | - Overall Hazard Risk       |
                              | - Model Uncertainty         |
                              +--------------+--------------+
                                             |
                                             v
                              +-----------------------------+
                              | Standard 6-Band GeoTIFF     |
                              | Mars IAU 2000 (EPSG:104905) |
                              | + Sidecar Metadata JSON     |
                              +-----------------------------+
```

---

## 2. Temporal Framework: Training vs. Forecasting

The forecasting engine distinguishes between three distinct temporal domains:

1. **Historical Training Period:**
   - Multi-sol sequential atmospheric states derived from GCM simulations and observationally constrained historical data (e.g. OpenMARS MY28–35, covering 1999–2018).
   - Used to train the ML model to learn the differential atmospheric evolution $\frac{\partial \mathbf{Y}}{\partial t}$ across a 1-sol lead time.

2. **Forecast Initialization Date:**
   - Derived automatically from current Earth UTC time using the Allison & McEwen (2000) Mars24 ephemeris engine.
   - For example:
     - Earth UTC: `2026-11-15T00:46:29Z`
     - Mars Year: `MY 39`
     - Solar Longitude: $L_s = 22.05^\circ$ (Northern Spring / Aphelion season)
     - Mars Sol Date: `MSD 54343.56`
     - Coordinated Mars Time: `MTC 13:27:13`

3. **Forecast Target Period:**
   - The subsequent Martian sol (+1 sol, approximately 24h 39m ahead).
   - Target $L_s \approx 22.58^\circ$, target MSD $\approx 54344.56$.

> **Scientific Disclosure:** Current-date forecasts for 2026 or beyond are *simulation-conditioned estimates*. Because no live, continuous global satellite reanalysis currently streams in real time from Mars orbit, the system initializes the state using astronomical ephemeris and physical climate simulation priors.

---

## 3. Physical Hazard Variables & Scientific Thresholds

The pipeline models four environmental hazards and synthesizes them into an overall risk score and an uncertainty layer:

| Band | Hazard Layer | Variable / Unit | Nominal Range (Risk < 0.33) | Moderate Range (0.33 ≤ Risk < 0.70) | Severe / Extreme (Risk ≥ 0.70) | Scientific Basis & Citations |
|:---:|:---|:---|:---|:---|:---|:---|
| **1** | **Dust Hazard** | Column Dust Optical Depth ($\tau$ at 610 Pa) | $\tau < 0.5$ (clean / low background) | $0.5 \le \tau < 1.2$ (regional dust haze) | $\tau \ge 1.2$ (major dust storm / planet-encircling) | Montabone et al. (2015, 2020) *Icarus* & *JGR Planets* |
| **2** | **Wind Hazard** | Near-surface horizontal wind ($W_{\text{sfc}}$ in m/s) | $W < 10\text{ m/s}$ (light breeze) | $10 \le W < 20\text{ m/s}$ (sand saltation threshold) | $W \ge 20\text{ m/s}$ (abrasive Martian gale) | Greeley et al. (2000) *JGR*; Haberle et al. (2017) |
| **3** | **Extreme Cold** | Surface skin temperature ($T_{\text{surf}}$ in K) | $T > 200\text{ K}$ (operational range) | $155 \le T \le 200\text{ K}$ (cryogenic stress) | $T < 155\text{ K}$ (approaching $\text{CO}_2$ frost point ~148 K) | Kieffer et al. (1977); Vasavada et al. (2017) |
| **4** | **Extreme Heat** | Surface skin temperature ($T_{\text{surf}}$ in K) | $T < 265\text{ K}$ (nominal) | $265 \le T < 285\text{ K}$ (elevated thermal stress) | $T \ge 285\text{ K}$ (extreme midday basin heating) | NASA MSL / Perseverance Science Operations limits |
| **5** | **Overall Risk** | Composite index [0.0 - 1.0] | Safe operational envelope | Caution / heightened operational monitoring | Critical hazard condition | $R_{\text{overall}} = 0.75 \max(R_i) + 0.25 \sum w_i R_i$ |
| **6** | **Uncertainty** | Model confidence proxy [0.0 - 1.0] | High confidence | Moderate confidence | Elevated uncertainty near sharp gradients | Residual variance & decision-boundary proximity |

---

## 4. Output Specification: 6-Band GeoTIFF

- **File Format:** OGC-compliant Baseline TIFF 6.0 with GeoTIFF 1.0 tags.
- **Coordinate Reference System (CRS):**
  - Mars IAU 2000 Biaxial Ellipsoid
  - Proj4: `+proj=longlat +a=3396190 +b=3376200 +no_defs`
  - EPSG: `104905`
- **Spatial Grid:**
  - Standard resolution: $5.0^\circ \times 5.0^\circ$ (36 rows $\times$ 72 columns)
  - Latitude: $+90.0^\circ\text{N}$ to $-90.0^\circ\text{S}$
  - Longitude: $-180.0^\circ\text{E}$ to $+180.0^\circ\text{E}$ (CesiumJS standard) or $0.0^\circ\text{E}$ to $360.0^\circ\text{E}$
- **Data Type:** IEEE 32-bit floating point (`float32`), `nodata = -9999.0`.
- **Sidecar JSON Metadata:** Emitted alongside every GeoTIFF containing initialization UTC, Mars Year, $L_s$, MSD, MTC, lead time, model provenance, and hazard threshold disclosures.

---

## 5. Minimal Data Download Strategy

The pipeline is architected to eliminate unnecessary large downloads:

1. **Remote Chunk Fetching:**
   - OpenMARS ARCO-Zarr on Hugging Face (`ananyo01/ARCO-OpenMars`) partitions 2D variables (`tsurf`, `dustcol`) into 120-timestep chunks ($\sim 200\text{ KB}$ per compressed chunk).
   - Instead of downloading the full 1.09 TB archive, the pipeline fetches only the single seasonal chunk needed.
2. **Selective Local Caching:**
   - Downloaded chunks and metadata are cached locally in `forecast/data/cache/`.
   - Subsequent executions check the cache before making any network request.
3. **Embedded Physical Simulation Generator:**
   - Includes a deterministic, physical Mars climate simulator (`MarsDataAccess.generate_synthetic_physical_state`) based on the Allison & McEwen insolation equations, diurnal thermal inertia decay, and Montabone dust climatology.
   - Allows full offline development, instant training, and self-contained CI testing without requiring network access.

---

## 6. Installation & Execution

### Prerequisites
- Python 3.10+ (tested with Python 3.15)
- Standard scientific Python libraries: `numpy`, `scipy`, `pyyaml`, `matplotlib`

### Running the Forecast

All commands should be executed from within the `forecast/` directory.

#### Mode 1: Forecast for Current Martian Date
```powershell
$env:PYTHONPATH = ".;.venv/Lib/site-packages"
python scripts/generate_forecast.py --mode current --plot
```
**Sample Output:**
```
======================================================================
      MARS ENVIRONMENTAL HAZARD FORECASTING PIPELINE (ML/GCM)      
======================================================================
[*] Running Mode 1: Current Martian Date Forecast...

--- Martian Astronomical Ephemeris ---
 Earth UTC:        2026-11-15T00:49:03.963702+00:00
 Mars Year:        MY 39
 Solar Longitude:  Ls = 22.05°
 Mars Sol Date:    MSD 54343.56
 Coordinated Mars: MTC 13:29:43
 Season:           Northern Spring / Southern Autumn (Aphelion season, low dust activity)
 Solar Distance:   1.6087 AU

--- Generated Forecast Layers ---
 GeoTIFF (6-Band): forecast/outputs/mars_hazard_forecast_current_20261115_004903.tif
 Metadata JSON:    forecast/outputs/mars_hazard_forecast_current_20261115_004903.json
 Preview PNG:      forecast/outputs/mars_hazard_forecast_current_20261115_004903.png
```

#### Mode 2: Historical Simulation & Validation
```powershell
$env:PYTHONPATH = ".;.venv/Lib/site-packages"
python scripts/generate_forecast.py --mode historical --date 2018-06-15
```
Evaluates next-sol prediction against actual state and benchmarks against Persistence and Seasonal Climatology baselines.

#### Running Unit Tests
```powershell
$env:PYTHONPATH = ".;.venv/Lib/site-packages"
python -m unittest discover -s tests -p "test_*.py"
```
Runs the 18 automated unit tests covering Mars ephemeris, hazard formulas, GeoTIFF binary encoding, and ML regression.

---

## 7. Directory Structure

```
forecast/
├── config/
│   └── default_config.yaml         # Configurable thresholds, grid specs, and model params
├── data/
│   ├── cache/                      # Locally cached remote chunks and metadata
│   ├── processed/                  # Preprocessed training arrays
│   └── raw/                        # Optional downloaded GCM files
├── models/
│   └── mars_hybrid_forecaster.pkl  # Trained ML model checkpoint
├── outputs/
│   ├── mars_hazard_forecast_latest.tif   # 6-Band GeoTIFF (current forecast alias)
│   ├── mars_hazard_forecast_latest.json  # Metadata JSON sidecar
│   └── *.png                             # Visual preview maps
├── scripts/
│   └── generate_forecast.py        # CLI entry point
├── src/
│   ├── __init__.py
│   ├── data_access.py              # Remote Zarr reader & physical simulation generator
│   ├── evaluation.py               # Scientific metrics (MAE, RMSE, Pearson r) vs baselines
│   ├── forecast_runner.py          # Dual-mode forecast orchestrator
│   ├── geotiff_export.py           # Pure-Python GeoTIFF 1.0 & metadata exporter
│   ├── hazard_scores.py            # Normalized hazard risk transformation functions
│   ├── mars_time.py                # Allison & McEwen (2000) Mars24 ephemeris engine
│   ├── models.py                   # Baselines (Persistence, Climatology) & Hybrid ML
│   └── preprocessing.py            # Feature extraction & temporal train/val split
├── tests/
│   ├── test_geotiff_export.py      # Binary TIFF structure & GeoKey validation tests
│   ├── test_hazard_scores.py       # Monotonicity & threshold boundary tests
│   ├── test_mars_time.py           # Ephemeris, MSD, and Clancy Mars Year tests
│   └── test_pipeline_components.py # Feature extraction, model fit, and evaluation tests
├── .gitignore
├── README.md
└── requirements.txt
```

---

## 8. Limitations & Decision-Support Disclosure

1. **Non-Certified:** This software is a research and decision-support prototype. It is **not certified for mission-critical life-support or astronaut extravehicular activity (EVA) go/no-go decisions**.
2. **Current-Date Conditioning:** Mars does not currently have real-time operational global weather satellites streaming observational data to Earth on a daily cadence. The current-date forecast represents an astronomical ephemeris and GCM-conditioned state transition, not an assimilation of live today-on-Mars measurements.
3. **Micro-Scale Topography:** Near-surface winds and temperatures represent grid-cell averages ($5^\circ \approx 300\text{ km}$). Micro-scale canyon gusts, crater katabatic winds, and local dust devils may exceed these regional predictions.
