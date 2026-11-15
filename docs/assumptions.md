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

---

## Survival model as implemented (`web/survival.js`, mirrored in `route.json → params`)

Added Sun 15 Nov 2026 by agent:yasser. These are the numbers the survival card uses. Most are
**ASSUMED** — order-of-magnitude values chosen to be plausible and internally consistent (each
consumable lasts roughly an 8-hour EVA at the flat-walking rate), not mission data. Change them in
`SURVIVAL_PARAMS` / `DEFAULT_CREW` and here together.

| Symbol (code) | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `g_mars` | surface gravity | 3.71 | m/s² | NASA NSSDC Mars fact sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | CITED |
| `MARS_RADIUS_M` | radius for distances | 3 396 190 | m | IAU 2000 Mars equatorial radius (same as `pathfinding.js`, `Cesium.Ellipsoid.MARS`) | CITED |
| `v0_kmh` | suited walking speed, flat | 2.5 | km/h | — | ASSUMED |
| `tobler_a`, `tobler_b` | speed vs grade: v = v0·e^(−a·|g+b|)/e^(−a·b) | 3.5, 0.05 | – | Tobler (1993) hiking function, normalised so v(0)=v0 | CITED form, ASSUMED for suits on Mars |
| `max_slope_deg` | hard slope mask | 25 (UI slider) | ° | — | ASSUMED |
| `metabolic_flat_w` | metabolic rate walking on the flat | 272 | W | ~Apollo lunar-surface EVA average of ~234 kcal/h (Waligora & Horrigan, *Biomedical Results of Apollo*, NASA SP-368, 1975) — verify | ASSUMED (literature-informed) |
| `metabolic_stop_w` | metabolic rate while sampling | 230 | W | — | ASSUMED |
| uphill term | extra power = m·g·v_up / η | – | W | mechanical work of lifting body + suit | physics |
| `eta_muscle` | muscular efficiency, climbing | 0.25 | – | textbook range ~0.2–0.25 | ASSUMED |
| `suit_mass_kg` | suit + life support carried | 60 | kg | — | ASSUMED |
| `body_mass_kg` | crew A / B | 72 / 88 | kg | — | ASSUMED |
| `metabolic_scale` | crew A / B multiplier | 1.0 / 1.15 | – | — | ASSUMED |
| `e_o2_j_per_kg` | energy per kg O₂ consumed | 14.07 × 10⁶ | J/kg | ~20.1 kJ per litre O₂ (indirect calorimetry, Weir 1949) at 1.429 g/L | CITED |
| `l_sub_j_per_kg` | latent heat of sublimation of ice | 2.83 × 10⁶ | J/kg | physical constant | CITED |
| `f_cool` | share of metabolic heat rejected by the sublimator | 0.8 | – | — | ASSUMED |
| `suit_power_w` | average electrical draw (fans, pump, radio, heaters) | 55 | W | — | ASSUMED |
| `o2_kg` | usable O₂ per suit | 0.54 | kg | order of the NASA EMU primary O₂ load (~1.2 lb) — verify | ASSUMED |
| `water_kg` | usable cooling water per suit | 3.6 | kg | order of the EMU feedwater load — verify | ASSUMED |
| `battery_wh` | usable battery per suit | 450 | Wh | order of the EMU battery — verify | ASSUMED |
| `stop_dwell_s` | sampling time per science stop | 1200 | s | — | ASSUMED |
| `reserve_frac` | reserve required at return | 0.20 | – | design decision | FIXED |
| `blackout_grace_s` | blackout treated as recoverable | 60 | s | design decision | FIXED |
| `blackout_k` | risk cost per blackout second beyond grace | 1 | s/s | — | ASSUMED |
| `haven_antenna_m`, `suit_antenna_m` | antenna heights for line of sight | 3, 2 | m | — | ASSUMED |

Model limits (shown in the UI): the return leg is the outbound path walked backwards (an upper
bound — a shortest-path return could be shorter); line of sight is computed on the planner's
km-scale grid; no thermal environment, dust, or fatigue term; hypothetical failure scenarios
(`SCENARIOS`) are demo stimuli, not failure statistics.
