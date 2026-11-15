"""
Unit tests for GeoTIFF and Metadata Export Module.
"""

import unittest
import numpy as np
import struct
import json
import tempfile
from pathlib import Path
import sys

forecast_root = Path(__file__).resolve().parent.parent
if str(forecast_root) not in sys.path:
    sys.path.insert(0, str(forecast_root))

from src.geotiff_export import (
    export_hazard_geotiff,
    export_metadata_json,
    BAND_NAMES,
)


class TestGeoTIFFExport(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_export_and_parse_geotiff_binary(self):
        shape = (36, 72)
        hazard_data = {
            name: np.full(shape, (i + 1) * 0.15, dtype=np.float32)
            for i, name in enumerate(BAND_NAMES)
        }

        tif_path = self.temp_path / "test_forecast.tif"
        export_hazard_geotiff(
            hazard_data,
            tif_path,
            lon_range="180",
            metadata_extra={"forecast_mode": "test_mode"},
        )

        self.assertTrue(tif_path.exists())
        file_bytes = tif_path.read_bytes()

        # 1. Verify TIFF Header
        byte_order, magic, ifd_offset = struct.unpack_from("<2sHI", file_bytes, 0)
        self.assertEqual(byte_order, b"II")
        self.assertEqual(magic, 42)
        self.assertEqual(ifd_offset, 8)

        # 2. Parse IFD Tags
        num_tags = struct.unpack_from("<H", file_bytes, ifd_offset)[0]
        self.assertGreaterEqual(num_tags, 10)

        tags = {}
        for i in range(num_tags):
            entry_offset = ifd_offset + 2 + (i * 12)
            tag_id, tag_type, count, val_or_offset = struct.unpack_from("<HHII", file_bytes, entry_offset)
            tags[tag_id] = (tag_type, count, val_or_offset)

        # Tag 256: ImageWidth (72)
        self.assertIn(256, tags)
        self.assertEqual(tags[256][2], 72)

        # Tag 257: ImageLength (36)
        self.assertIn(257, tags)
        self.assertEqual(tags[257][2], 36)

        # Tag 277: SamplesPerPixel (6 bands)
        self.assertIn(277, tags)
        self.assertEqual(tags[277][2], 6)

        # Tag 33550: ModelPixelScaleTag (3 doubles = 24 bytes)
        self.assertIn(33550, tags)
        scale_offset = tags[33550][2]
        sx, sy, sz = struct.unpack_from("<3d", file_bytes, scale_offset)
        self.assertAlmostEqual(sx, 360.0 / 72.0)
        self.assertAlmostEqual(sy, 180.0 / 36.0)

        # Tag 33922: ModelTiepointTag (6 doubles: 0,0,0, west, north, 0)
        self.assertIn(33922, tags)
        tiepoint_offset = tags[33922][2]
        _, _, _, west, north, _ = struct.unpack_from("<6d", file_bytes, tiepoint_offset)
        self.assertAlmostEqual(west, -180.0)
        self.assertAlmostEqual(north, 90.0)

        # Tag 34735: GeoKeyDirectoryTag
        self.assertIn(34735, tags)

        # Tag 279: StripByteCounts (payload size = 6 * 36 * 72 * 4 = 62208 bytes)
        self.assertIn(279, tags)
        self.assertEqual(tags[279][2], 6 * 36 * 72 * 4)

    def test_export_metadata_json(self):
        meta = {
            "model": "Physical-Simulation-GBDT",
            "date": "2026-11-15",
            "ls": 22.0,
            "disclaimer": "Decision support only",
        }
        json_path = self.temp_path / "metadata.json"
        export_metadata_json(meta, json_path)
        self.assertTrue(json_path.exists())

        with open(json_path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        self.assertEqual(loaded["model"], "Physical-Simulation-GBDT")
        self.assertEqual(loaded["ls"], 22.0)


if __name__ == "__main__":
    unittest.main()
