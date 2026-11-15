"""
Mars Ephemeris and Calendar Engine
Implements the Allison & McEwen (2000) Mars24 ephemeris algorithm for converting
Earth UTC to Mars Solar Date (MSD), Solar Longitude (Ls), Mars Year (MY), and Martian Season.

Reference:
Allison, M., & McEwen, M. (2000). A post-Pathfinder evaluation of areocentric solar
coordinates with improved timing recipes for Mars seasonal/diurnal climate studies.
Planetary and Space Science, 48(2-3), 215-235.
"""

from __future__ import annotations
import math
from datetime import datetime, timezone
from typing import Dict, Any


class MarsTimeEngine:
    """Accurate Mars astronomical ephemeris and calendar calculator."""

    # Reference Mars Year 39 start at Ls=0 (2026-09-30 00:00:00 UTC, MSD ~ 54295.0)
    # Mars orbital period is ~668.5991 sols
    MARS_SOL_YEAR = 668.5991
    MY39_START_MSD = 54295.0
    REF_MY = 39

    @staticmethod
    def utc_to_jd_tt(dt: datetime) -> float:
        """
        Convert UTC datetime to Julian Date in Terrestrial Time (JD_TT).
        Applies UTC->TT offset (TAI-UTC leap seconds + 32.184s).
        """
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)

        ts = dt.timestamp()
        jd_ut = 2440587.5 + (ts / 86400.0)

        # Approximate Delta T = TT - UT1 for modern era (~69.2 seconds)
        delta_t_seconds = 69.184
        jd_tt = jd_ut + (delta_t_seconds / 86400.0)
        return jd_tt

    @classmethod
    def calculate_ephemeris(cls, dt: datetime) -> Dict[str, Any]:
        """
        Compute Mars ephemeris parameters for a given Earth UTC datetime.

        Returns:
            dict containing:
                - utc_iso: ISO 8601 UTC string
                - jd_tt: Julian Date in Terrestrial Time
                - msd: Mars Sol Date
                - mtc_hours: Coordinated Mars Time (hours: 0..24)
                - mtc_formatted: HH:MM:SS format
                - ls_deg: Solar longitude (0..360 deg)
                - mars_year: Mars Year according to Clancy et al.
                - season: Northern/Southern hemisphere seasonal description
                - heliocentric_distance_au: Distance from Sun in Astronomical Units
        """
        jd_tt = cls.utc_to_jd_tt(dt)

        # Days since J2000 epoch (2000-01-01 12:00:00 TT, JD 2451545.0)
        delta_j2000 = jd_tt - 2451545.0

        # Mars Sol Date (MSD) per Allison & McEwen (2000) eq. 27
        # Relative to JD 2405522.0 (1873-12-29 12:00:00 TT)
        msd = (jd_tt - 2405522.0) / 1.027491252
        mtc_hours = (msd * 24.0) % 24.0
        mtc_h = int(mtc_hours)
        mtc_m = int((mtc_hours - mtc_h) * 60)
        mtc_s = int(((mtc_hours - mtc_h) * 60 - mtc_m) * 60)
        mtc_formatted = f"{mtc_h:02d}:{mtc_m:02d}:{mtc_s:02d}"

        # Mean anomaly of Mars (degrees)
        m = (19.3870 + 0.52402075 * delta_j2000) % 360.0
        m_rad = math.radians(m)

        # Fictitious Mean Sun angle (degrees)
        alpha_fms = (270.3863 + 0.52403840 * delta_j2000) % 360.0

        # Perturbation sum (PBS) from planetary gravitational interactions
        pbs = (
            0.0071 * math.cos(math.radians((0.99836 * delta_j2000) + 167.33))
            + 0.0057 * math.cos(math.radians((0.15827 * delta_j2000) + 212.83))
            + 0.0039 * math.cos(math.radians((0.54576 * delta_j2000) + 279.06))
            + 0.0037 * math.cos(math.radians((0.53909 * delta_j2000) + 31.32))
            + 0.0021 * math.cos(math.radians((1.30460 * delta_j2000) + 99.41))
            + 0.0020 * math.cos(math.radians((0.58338 * delta_j2000) + 288.78))
            + 0.0018 * math.cos(math.radians((0.40276 * delta_j2000) + 178.62))
        )

        # Equation of the center (nu - M)
        nu_minus_m = (
            (10.691 + 3.0e-7 * delta_j2000) * math.sin(m_rad)
            + 0.623 * math.sin(2.0 * m_rad)
            + 0.050 * math.sin(3.0 * m_rad)
            + 0.005 * math.sin(4.0 * m_rad)
            + 0.0005 * math.sin(5.0 * m_rad)
            + pbs
        )

        # Areocentric solar longitude Ls (degrees: 0 to 360)
        ls_deg = (alpha_fms + nu_minus_m) % 360.0
        if ls_deg < 0:
            ls_deg += 360.0

        # True anomaly nu
        nu = (m + nu_minus_m) % 360.0
        nu_rad = math.radians(nu)

        # Heliocentric distance r (AU)
        ecc = 0.09340
        dist_au = (1.52368 * (1.0 - ecc**2)) / (1.0 + ecc * math.cos(nu_rad))

        # Determine Mars Year (Clancy et al. standard calendar)
        # Year increments when Ls wraps through 0°
        my_float = cls.REF_MY + (msd - cls.MY39_START_MSD) / cls.MARS_SOL_YEAR
        mars_year = int(math.floor(my_float))

        # Season description
        season = cls.get_season_description(ls_deg)

        return {
            "utc_iso": dt.isoformat(),
            "jd_tt": round(jd_tt, 5),
            "msd": round(msd, 4),
            "mtc_hours": round(mtc_hours, 3),
            "mtc_formatted": mtc_formatted,
            "ls_deg": round(ls_deg, 3),
            "mars_year": mars_year,
            "season": season,
            "heliocentric_distance_au": round(dist_au, 4),
        }

    @staticmethod
    def get_season_description(ls_deg: float) -> str:
        """Return standardized astronomical season for Mars."""
        ls = ls_deg % 360.0
        if 0.0 <= ls < 90.0:
            return "Northern Spring / Southern Autumn (Aphelion season, low dust activity)"
        elif 90.0 <= ls < 180.0:
            return "Northern Summer / Southern Winter (Aphelion around Ls=71, clear skies)"
        elif 180.0 <= ls < 270.0:
            return "Northern Autumn / Southern Spring (Perihelion season begins, dust storm season)"
        else:
            return "Northern Winter / Southern Summer (Perihelion at Ls=251, peak global dust activity)"


def get_current_martian_date() -> Dict[str, Any]:
    """Convenience helper to get current Mars ephemeris for datetime.now(timezone.utc)."""
    return MarsTimeEngine.calculate_ephemeris(datetime.now(timezone.utc))
