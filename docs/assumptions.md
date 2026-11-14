# Assumptions and coefficients

Every number the app uses to make a decision goes in this file, with a source URL or an
explicit `ASSUMED` label. Anything shown in the UI as fact must be sourced here.

Rules:

1. No coefficient without a row in this table.
2. `ASSUMED` values are allowed — but they must say `ASSUMED` in the table **and** in the UI tooltip.
3. Prefer a range and a midpoint over a single confident digit.
4. If a source can't be found in 15 minutes, mark it `ASSUMED` and move on. Honesty beats precision.

---

## Mobility

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `v0` | walking speed, flat, suited | | km/h | | |
| `slope_penalty` | speed multiplier vs slope | | – | | |
| `roughness_penalty` | speed multiplier vs terrain roughness | | – | | |
| `max_slope` | suit mobility limit (hard mask) | | ° | | |
| `suit_mass` | suit + PLSS mass | | kg | | |
| `g_mars` | Martian surface gravity | 3.71 | m/s² | | |
| `load_penalty` | speed multiplier vs carried equipment | | – | | |

## Metabolism and consumables

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `metabolic_flat` | metabolic rate, flat traverse | | W | | |
| `metabolic_slope` | additional rate per degree of slope | | W/° | | |
| `o2_per_joule` | O₂ mass consumed per joule | | kg/J | | |
| `plss_o2` | usable O₂ capacity | | kg | | |
| `suit_power` | suit power draw (fans, pumps, heaters, comms) | | W | | |
| `battery_capacity` | usable battery energy | | Wh | | |
| `eva_max` | max EVA duration | | h | | |
| `reserve` | required reserve at return | 20 | % | design decision | FIXED |

## Comms

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `blackout_grace` | blackout length treated as recoverable | 60 | s | design decision | FIXED |
| `blackout_k` | cost per second of blackout beyond grace | | s/s | | |
| `relay_position` | fixed relay (lander) lat/lon | | ° | | |

## Environment

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `dose_rate` | surface dose equivalent | 0.21 | mGy/day | Hassler et al. 2014 | CITED |
| `dose_budget` | mission dose budget | | mGy | | |
| `temp_range` | surface temperature range | | °C | MSL/REMS JSON | LIVE |

---

## Honesty constraints (UI copy)

- **No dust optical depth.** `atmo_opacity` is qualitative ("Sunny"/"Cloudy"). There is no public τ
  feed. Never display a τ number.
- **No "forecast".** We show measured atmosphere from past sols. Weather on Mars has no operational
  forecast service. Say "latest sol" and "climatology", never "forecast".
- **Radiation is modelled**, not measured — label it in the UI.
- **Resolution tiers are visible.** Any site outside Gale/Jezero shows "coarse data — not walk-scale".
- **No "anywhere on Mars" claim.** Say: "generates a mission view for any site, demonstrated at Gale."
