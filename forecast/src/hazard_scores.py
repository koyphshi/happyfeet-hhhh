"""
Mars Environmental Hazard Scoring Engine
Computes normalized hazard risk indices [0.0, 1.0] from physical Martian atmospheric
and surface variables.

Citations & Scientific Threshold Foundations:
1. Dust Hazard:
   - Variable: Column Dust Optical Depth (CDOD tau normalized to 610 Pa equivalent).
   - Reference: Montabone, L., et al. (2015, 2020). "An updated climatology of surface
     dust optical depth on Mars." Icarus 251, 65-95; J. Geophys. Res. Planets 125(8).
   - Levels: tau < 0.5 (nominal), 0.5-1.2 (moderate regional haze/event), >= 1.2 (severe storm).

2. Wind Hazard:
   - Variable: Near-surface horizontal wind speed (m/s).
   - Reference: Greeley, R., et al. (2000). "Martian dust devils: Laboratory simulations of
     particle threshold." J. Geophys. Res. 105(E1), 1829-1840.
   - Note: Dynamic pressure on Mars is ~1% of Earth's due to thin atmosphere (~6 hPa),
     but saltation threshold for grain movement occurs at 15-25 m/s.
   - Levels: < 10 m/s (nominal), 10-20 m/s (moderate dust lifting), >= 20 m/s (severe gale).

3. Extreme Cold Hazard:
   - Variable: Surface skin temperature (Kelvin).
   - Reference: Kieffer, H. H., et al. (1977); Vasavada, A. R., et al. (2017).
   - Note: CO2 sublimation/condensation point is ~148 K at 6.1 hPa. Temperatures below
     155 K risk dry-ice frosting and structural embrittlement.
   - Levels: > 200 K (nominal), 155-200 K (cryogenic operational challenge), < 155 K (extreme freeze).

4. Extreme Heat Hazard:
   - Variable: Surface skin temperature (Kelvin).
   - Reference: NASA MSL/Perseverance Environmental Science Operations & Rover thermal design limits.
   - Levels: < 265 K (nominal), 265-285 K (elevated heat), >= 285 K (extreme surface thermal stress).
"""

from __future__ import annotations
import numpy as np
from typing import Dict, Any, Union


def compute_dust_risk(dustcol: Union[float, np.ndarray]) -> Union[float, np.ndarray]:
    """
    Compute normalized dust hazard risk [0.0, 1.0] from optical depth tau.

    Piecewise linear interpolation:
      tau <= 0.0 -> 0.0
      0.0 < tau <= 0.5 -> 0.0 to 0.33 (nominal atmospheric dust)
      0.5 < tau <= 1.2 -> 0.33 to 0.70 (moderate regional dust lifting)
      1.2 < tau <= 3.0 -> 0.70 to 1.00 (severe / planet-encircling dust storm)
      tau > 3.0 -> 1.00
    """
    dust = np.asarray(dustcol, dtype=np.float32)
    risk = np.zeros_like(dust, dtype=np.float32)

    # 0.0 <= tau <= 0.5
    mask1 = (dust > 0.0) & (dust <= 0.5)
    risk[mask1] = (dust[mask1] / 0.5) * 0.33

    # 0.5 < tau <= 1.2
    mask2 = (dust > 0.5) & (dust <= 1.2)
    risk[mask2] = 0.33 + ((dust[mask2] - 0.5) / 0.7) * (0.70 - 0.33)

    # 1.2 < tau <= 3.0
    mask3 = (dust > 1.2) & (dust <= 3.0)
    risk[mask3] = 0.70 + ((dust[mask3] - 1.2) / 1.8) * (1.00 - 0.70)

    # tau > 3.0
    mask4 = dust > 3.0
    risk[mask4] = 1.0

    if np.isscalar(dustcol):
        return float(risk.item())
    return risk


def compute_wind_risk(wind_speed: Union[float, np.ndarray]) -> Union[float, np.ndarray]:
    """
    Compute normalized wind hazard risk [0.0, 1.0] from wind speed (m/s).

    Piecewise linear interpolation:
      ws <= 0.0 -> 0.0
      0.0 < ws <= 10.0 -> 0.0 to 0.30 (nominal light breeze)
      10.0 < ws <= 20.0 -> 0.30 to 0.70 (moderate wind / sand saltation threshold)
      20.0 < ws <= 40.0 -> 0.70 to 1.00 (severe Martian gale)
      ws > 40.0 -> 1.00
    """
    ws = np.asarray(wind_speed, dtype=np.float32)
    risk = np.zeros_like(ws, dtype=np.float32)

    mask1 = (ws > 0.0) & (ws <= 10.0)
    risk[mask1] = (ws[mask1] / 10.0) * 0.30

    mask2 = (ws > 10.0) & (ws <= 20.0)
    risk[mask2] = 0.30 + ((ws[mask2] - 10.0) / 10.0) * (0.70 - 0.30)

    mask3 = (ws > 20.0) & (ws <= 40.0)
    risk[mask3] = 0.70 + ((ws[mask3] - 20.0) / 20.0) * (1.00 - 0.70)

    mask4 = ws > 40.0
    risk[mask4] = 1.0

    if np.isscalar(wind_speed):
        return float(risk.item())
    return risk


def compute_cold_risk(tsurf: Union[float, np.ndarray]) -> Union[float, np.ndarray]:
    """
    Compute normalized extreme cold hazard risk [0.0, 1.0] from surface temperature (K).

    Piecewise linear interpolation:
      tsurf >= 200.0 K -> 0.0 to 0.25 (nominal)
      155.0 <= tsurf < 200.0 K -> 0.25 to 0.75 (moderate cryogenic stress)
      130.0 <= tsurf < 155.0 K -> 0.75 to 1.00 (extreme CO2 frost hazard)
      tsurf < 130.0 K -> 1.00
    """
    t = np.asarray(tsurf, dtype=np.float32)
    risk = np.zeros_like(t, dtype=np.float32)

    # t >= 200 K: nominal
    mask1 = t >= 200.0
    # Warmest temps (e.g. 260K) have ~0 risk, drops to 0.25 as t approaches 200K
    risk[mask1] = np.clip(0.25 * (260.0 - t[mask1]) / 60.0, 0.0, 0.25)

    # 155 <= t < 200 K
    mask2 = (t >= 155.0) & (t < 200.0)
    risk[mask2] = 0.25 + ((200.0 - t[mask2]) / 45.0) * (0.75 - 0.25)

    # 130 <= t < 155 K
    mask3 = (t >= 130.0) & (t < 155.0)
    risk[mask3] = 0.75 + ((155.0 - t[mask3]) / 25.0) * (1.00 - 0.75)

    # t < 130 K
    mask4 = t < 130.0
    risk[mask4] = 1.0

    if np.isscalar(tsurf):
        return float(risk.item())
    return risk


def compute_heat_risk(tsurf: Union[float, np.ndarray]) -> Union[float, np.ndarray]:
    """
    Compute normalized extreme heat hazard risk [0.0, 1.0] from surface temperature (K).

    Piecewise linear interpolation:
      tsurf <= 265.0 K -> 0.0
      265.0 < tsurf <= 285.0 K -> 0.0 to 0.60 (elevated heat stress on electronics)
      285.0 < tsurf <= 305.0 K -> 0.60 to 1.00 (extreme thermal threshold)
      tsurf > 305.0 K -> 1.00
    """
    t = np.asarray(tsurf, dtype=np.float32)
    risk = np.zeros_like(t, dtype=np.float32)

    mask1 = (t > 265.0) & (t <= 285.0)
    risk[mask1] = ((t[mask1] - 265.0) / 20.0) * 0.60

    mask2 = (t > 285.0) & (t <= 305.0)
    risk[mask2] = 0.60 + ((t[mask2] - 285.0) / 20.0) * (1.00 - 0.60)

    mask3 = t > 305.0
    risk[mask3] = 1.0

    if np.isscalar(tsurf):
        return float(risk.item())
    return risk


def compute_overall_risk(
    r_dust: Union[float, np.ndarray],
    r_wind: Union[float, np.ndarray],
    r_cold: Union[float, np.ndarray],
    r_heat: Union[float, np.ndarray],
    weights: tuple = (0.35, 0.25, 0.20, 0.20),
) -> Union[float, np.ndarray]:
    """
    Compute combined overall hazard risk score [0.0, 1.0].
    Combines max-hazard priority (75%) with multi-hazard weighted accumulation (25%).

    Formula:
      R_max = max(R_dust, R_wind, R_cold, R_heat)
      R_blend = w_dust*R_dust + w_wind*R_wind + w_cold*R_cold + w_heat*R_heat
      R_overall = 0.75 * R_max + 0.25 * R_blend
    """
    rd = np.asarray(r_dust, dtype=np.float32)
    rw = np.asarray(r_wind, dtype=np.float32)
    rc = np.asarray(r_cold, dtype=np.float32)
    rh = np.asarray(r_heat, dtype=np.float32)

    w_dust, w_wind, w_cold, w_heat = weights
    r_blend = w_dust * rd + w_wind * rw + w_cold * rc + w_heat * rh

    r_max = np.maximum(np.maximum(rd, rw), np.maximum(rc, rh))
    r_overall = 0.75 * r_max + 0.25 * r_blend
    r_overall = np.clip(r_overall, 0.0, 1.0)

    if np.isscalar(r_dust) and np.isscalar(r_wind) and np.isscalar(r_cold) and np.isscalar(r_heat):
        return float(r_overall.item())
    return r_overall


def compute_all_hazard_rasters(
    tsurf: np.ndarray,
    wind_speed: np.ndarray,
    dustcol: np.ndarray,
    uncertainty: np.ndarray | None = None,
) -> Dict[str, np.ndarray]:
    """
    Compute full 6-band hazard arrays:
      1. dust_risk
      2. wind_risk
      3. cold_risk
      4. heat_risk
      5. overall_risk
      6. uncertainty
    """
    r_dust = compute_dust_risk(dustcol)
    r_wind = compute_wind_risk(wind_speed)
    r_cold = compute_cold_risk(tsurf)
    r_heat = compute_heat_risk(tsurf)
    r_overall = compute_overall_risk(r_dust, r_wind, r_cold, r_heat)

    if uncertainty is None:
        # Default baseline uncertainty heuristic: higher in regions of extreme gradients
        # or where hazard scores are close to decision boundaries (0.5)
        uncertainty = 0.15 + 0.20 * np.abs(r_overall - 0.5)

    return {
        "dust_hazard_risk": r_dust.astype(np.float32),
        "wind_hazard_risk": r_wind.astype(np.float32),
        "cold_hazard_risk": r_cold.astype(np.float32),
        "heat_hazard_risk": r_heat.astype(np.float32),
        "overall_hazard_risk": r_overall.astype(np.float32),
        "model_uncertainty": np.clip(uncertainty, 0.0, 1.0).astype(np.float32),
    }


def get_threshold_documentation() -> Dict[str, Any]:
    """Return scientific documentation and provence for all hazard thresholds."""
    return {
        "status": "provisional_engineering_reference",
        "description": "Hazard thresholds calibrated for research/decision-support use.",
        "hazards": {
            "dust": {
                "variable": "Column Dust Optical Depth (CDOD tau at 610 Pa)",
                "nominal_range": "< 0.5",
                "moderate_range": "0.5 - 1.2",
                "severe_range": ">= 1.2",
                "citation": "Montabone et al. (2015, 2020) Icarus & JGR Planets",
                "limitation": "Optical depth does not measure grain size distribution or electrostatic charge.",
            },
            "wind": {
                "variable": "Near-surface horizontal wind speed (m/s)",
                "nominal_range": "< 10.0 m/s",
                "moderate_range": "10.0 - 20.0 m/s",
                "gale_range": ">= 20.0 m/s",
                "citation": "Greeley et al. (2000) JGR; Haberle et al. (2017) Cambridge Univ Press",
                "limitation": "Near-surface wind from GCM represents lowest atmospheric layer (~few meters), not micro-scale topography gusts.",
            },
            "cold": {
                "variable": "Surface skin temperature (K)",
                "nominal_range": "> 200 K",
                "moderate_range": "155 - 200 K",
                "extreme_range": "< 155 K",
                "citation": "Kieffer et al. (1977); Vasavada et al. (2017)",
                "limitation": "Skin temperature differs from near-surface air temperature (air temperature is typically 5-20 K warmer at night).",
            },
            "heat": {
                "variable": "Surface skin temperature (K)",
                "nominal_range": "< 265 K",
                "elevated_range": "265 - 285 K",
                "extreme_range": ">= 285 K",
                "citation": "NASA MSL / Perseverance Science Operations operational limits",
                "limitation": "Maximum daytime temperatures occur in low-albedo equatorial basins (e.g. Isidis, Hellas).",
            },
        },
    }
