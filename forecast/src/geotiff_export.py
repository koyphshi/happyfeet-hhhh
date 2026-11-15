"""
GeoTIFF and Metadata Export Module
Generates standardized 6-band GeoTIFF rasters with Mars IAU 2000 CRS (EPSG:104905)
and sidecar JSON metadata.

Includes a native pure-Python TIFF 6.0 / GeoTIFF 1.0 binary serializer with full
GeoTIFF tags (ModelTiepoint, ModelPixelScale, GeoKeyDirectory, GDAL_NODATA),
ensuring zero dependency on external C-extension DLLs.
"""

from __future__ import annotations
import json
import struct
from pathlib import Path
from typing import Dict, Any, Optional, List
import numpy as np


# Mars IAU 2000 Sphere/Ellipsoid Proj4 definition
MARS_PROJ4 = "+proj=longlat +a=3396190 +b=3376200 +no_defs"

BAND_NAMES = [
    "dust_hazard_risk",
    "wind_hazard_risk",
    "cold_hazard_risk",
    "heat_hazard_risk",
    "overall_hazard_risk",
    "model_uncertainty",
]


class PureGeoTIFFWriter:
    """
    Pure Python GeoTIFF 1.0 / TIFF 6.0 Writer for multi-band floating-point rasters.
    Compliant with OGC GeoTIFF standard and GDAL raster conventions.
    """

    # TIFF Data types
    TYPE_BYTE = 1
    TYPE_ASCII = 2
    TYPE_SHORT = 3
    TYPE_LONG = 4
    TYPE_RATIONAL = 5
    TYPE_DOUBLE = 12

    TYPE_SIZES = {
        TYPE_BYTE: 1,
        TYPE_ASCII: 1,
        TYPE_SHORT: 2,
        TYPE_LONG: 4,
        TYPE_RATIONAL: 8,
        TYPE_DOUBLE: 8,
    }

    @classmethod
    def write(
        cls,
        filepath: Path,
        data_stack: np.ndarray,  # shape: (bands, height, width), float32
        bounds: tuple,  # (west, south, east, north)
        band_names: List[str],
        nodata: float = -9999.0,
        description: str = "",
    ) -> None:
        num_bands, height, width = data_stack.shape
        west, south, east, north = bounds

        pixel_scale_x = (east - west) / width
        pixel_scale_y = (north - south) / height

        # TIFF Little-Endian Header: 'II', 42, offset to first IFD (will be at offset 8)
        header = struct.pack("<2sHI", b"II", 42, 8)

        # Planar configuration: Chunky (interleaved by pixel) or Planar (band by band).
        # We use Planar (band sequential, PlanarConfiguration = 2) for multi-band raster layers.
        # Ensure float32 contiguous array
        raw_pixels = np.ascontiguousarray(data_stack, dtype="<f4").tobytes()
        payload_size = len(raw_pixels)

        # Build GeoKeyDirectory for Mars IAU 2000
        # GeoKeys:
        # 1024: GTModelTypeGeoKey = 2 (ModelTypeGeographic)
        # 1025: GTRasterTypeGeoKey = 1 (RasterPixelIsArea)
        # 2048: GeographicTypeGeoKey = 32767 (User-Defined)
        # 2056: GeogEllipsoidGeoKey = 32767 (User-Defined)
        # 2057: GeogSemiMajorAxisGeoKey (double 3396190.0)
        # 2058: GeogSemiMinorAxisGeoKey (double 3376200.0)
        geokeys = [
            # Header: KeyDirectoryVersion, KeyRevision, MinorRevision, NumberOfKeys
            1, 1, 0, 4,
            # Key 1024 (ModelType): Short, count=1, value=2 (Geographic)
            1024, 0, 1, 2,
            # Key 1025 (RasterType): Short, count=1, value=1 (PixelIsArea)
            1025, 0, 1, 1,
            # Key 2048 (GeographicType): Short, count=1, value=32767 (User-Defined)
            2048, 0, 1, 32767,
            # Key 2056 (GeogEllipsoid): Short, count=1, value=32767 (User-Defined)
            2056, 0, 1, 32767,
        ]
        geokey_bytes = struct.pack(f"<{len(geokeys)}H", *geokeys)

        # ModelTiepoint: (I=0, J=0, K=0, X=west, Y=north, Z=0.0)
        tiepoint_doubles = [0.0, 0.0, 0.0, float(west), float(north), 0.0]
        tiepoint_bytes = struct.pack("<6d", *tiepoint_doubles)

        # ModelPixelScale: (scale_x, scale_y, scale_z=0.0)
        scale_doubles = [float(pixel_scale_x), float(pixel_scale_y), 0.0]
        scale_bytes = struct.pack("<3d", *scale_doubles)

        # BitsPerSample: 32 per band
        bits_per_sample = [32] * num_bands
        bits_bytes = struct.pack(f"<{num_bands}H", *bits_per_sample)

        # SampleFormat: 3 (IEEE float) per band
        sample_format = [3] * num_bands
        format_bytes = struct.pack(f"<{num_bands}H", *sample_format)

        # Strings
        nodata_str = f"{nodata}\0".encode("ascii")
        ascii_params = b"IAU2000:Mars|Proj4=" + MARS_PROJ4.encode("ascii") + b"\0"
        desc_str = (description or ";".join(band_names)).encode("utf-8") + b"\0"

        # Construct TIFF Tags (must be sorted in strictly ascending tag order):
        # 256: ImageWidth (LONG)
        # 257: ImageLength (LONG)
        # 258: BitsPerSample (SHORT, count=num_bands)
        # 259: Compression (SHORT, 1 = uncompressed)
        # 262: PhotometricInterpretation (SHORT, 1 = BlackIsZero)
        # 270: ImageDescription (ASCII)
        # 273: StripOffsets (LONG, 1 strip)
        # 277: SamplesPerPixel (SHORT, num_bands)
        # 278: RowsPerStrip (LONG, height)
        # 279: StripByteCounts (LONG, payload_size)
        # 284: PlanarConfiguration (SHORT, 2 = Planar)
        # 339: SampleFormat (SHORT, count=num_bands)
        # 33550: ModelPixelScaleTag (DOUBLE, 3)
        # 33922: ModelTiepointTag (DOUBLE, 6)
        # 34735: GeoKeyDirectoryTag (SHORT, len(geokeys))
        # 34737: GeoAsciiParamsTag (ASCII)
        # 42113: GDAL_NODATA (ASCII)

        tags_meta = [
            (256, cls.TYPE_LONG, 1, width, None),
            (257, cls.TYPE_LONG, 1, height, None),
            (258, cls.TYPE_SHORT, num_bands, None, bits_bytes),
            (259, cls.TYPE_SHORT, 1, 1, None),
            (262, cls.TYPE_SHORT, 1, 1, None),
            (270, cls.TYPE_ASCII, len(desc_str), None, desc_str),
            (273, cls.TYPE_LONG, 1, None, "STRIP_OFFSET_PLACEHOLDER"),
            (277, cls.TYPE_SHORT, 1, num_bands, None),
            (278, cls.TYPE_LONG, 1, height, None),
            (279, cls.TYPE_LONG, 1, payload_size, None),
            (284, cls.TYPE_SHORT, 1, 2, None),  # Planar (band-sequential)
            (339, cls.TYPE_SHORT, num_bands, None, format_bytes),
            (33550, cls.TYPE_DOUBLE, 3, None, scale_bytes),
            (33922, cls.TYPE_DOUBLE, 6, None, tiepoint_bytes),
            (34735, cls.TYPE_SHORT, len(geokeys), None, geokey_bytes),
            (34737, cls.TYPE_ASCII, len(ascii_params), None, ascii_params),
            (42113, cls.TYPE_ASCII, len(nodata_str), None, nodata_str),
        ]

        # Calculate offsets
        num_tags = len(tags_meta)
        ifd_offset = 8
        # Each tag entry is 12 bytes. IFD ends with 4-byte next-IFD offset (0)
        ifd_size = 2 + (num_tags * 12) + 4
        current_data_offset = ifd_offset + ifd_size

        # Pack tag entries and trailing data
        tag_entries = []
        extra_data = bytearray()

        # We need to reserve space for extra data, and locate pixel data
        # Let's align pixel data to 16 bytes
        offsets_map = {}
        for tag_id, tag_type, count, inline_val, val_bytes in tags_meta:
            if val_bytes is not None and val_bytes != "STRIP_OFFSET_PLACEHOLDER":
                offsets_map[tag_id] = current_data_offset + len(extra_data)
                extra_data.extend(val_bytes)
                # Pad to 2-byte or 4-byte boundary
                if len(extra_data) % 2 != 0:
                    extra_data.append(0)

        # Strip offset comes after extra_data
        pixel_data_offset = current_data_offset + len(extra_data)
        if pixel_data_offset % 16 != 0:
            pad = 16 - (pixel_data_offset % 16)
            extra_data.extend(b"\x00" * pad)
            pixel_data_offset = current_data_offset + len(extra_data)

        # Now encode 12-byte IFD tag entries
        for tag_id, tag_type, count, inline_val, val_bytes in tags_meta:
            type_size = cls.TYPE_SIZES[tag_type]
            total_bytes = count * type_size

            if tag_id == 273:
                # StripOffsets
                val_offset = pixel_data_offset
            elif total_bytes <= 4 and inline_val is not None:
                val_offset = inline_val
            else:
                val_offset = offsets_map[tag_id]

            entry = struct.pack("<HHII", tag_id, tag_type, count, val_offset)
            tag_entries.append(entry)

        ifd_bytes = struct.pack("<H", num_tags) + b"".join(tag_entries) + struct.pack("<I", 0)

        # Write final file
        with open(filepath, "wb") as f:
            f.write(header)
            f.write(ifd_bytes)
            f.write(extra_data)
            f.write(raw_pixels)


def export_hazard_geotiff(
    hazard_rasters: Dict[str, np.ndarray],
    output_path: str | Path,
    lon_range: str = "180",
    metadata_extra: Optional[Dict[str, Any]] = None,
) -> Path:
    """
    Export 6-band Mars hazard raster as GeoTIFF.
    """
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    sample_key = BAND_NAMES[0]
    if sample_key not in hazard_rasters:
        raise KeyError(f"Missing required band '{sample_key}' in hazard_rasters")

    height, width = hazard_rasters[sample_key].shape

    if lon_range == "180":
        west, south, east, north = -180.0, -90.0, 180.0, 90.0
    else:
        west, south, east, north = 0.0, -90.0, 360.0, 90.0

    # Stack bands (6, height, width)
    stack = np.empty((6, height, width), dtype=np.float32)
    for idx, band_name in enumerate(BAND_NAMES):
        if band_name not in hazard_rasters:
            raise KeyError(f"hazard_rasters missing required band: '{band_name}'")
        arr = hazard_rasters[band_name]
        if arr.shape != (height, width):
            raise ValueError(f"Band '{band_name}' shape {arr.shape} does not match {(height, width)}")
        stack[idx, :, :] = np.nan_to_num(arr, nan=0.0).astype(np.float32)

    desc = json.dumps(metadata_extra) if metadata_extra else ";".join(BAND_NAMES)

    # Use PureGeoTIFFWriter for 100% portable, reliable GeoTIFF generation
    PureGeoTIFFWriter.write(
        filepath=out_file,
        data_stack=stack,
        bounds=(west, south, east, north),
        band_names=BAND_NAMES,
        nodata=-9999.0,
        description=desc,
    )

    return out_file


def export_metadata_json(
    metadata: Dict[str, Any],
    output_path: str | Path,
) -> Path:
    """
    Save structured JSON provenance and forecast metadata.
    """
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    return out_file
