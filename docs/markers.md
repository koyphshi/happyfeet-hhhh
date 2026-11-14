# Mission markers and panorama spots

The Mars viewer's marker feature is called **Mission spots** in the sidebar. It places curated science targets, landing sites, and rover panorama waypoints on the globe. Marker definitions are currently static data in `web/index.html` (`SPOTS`, with the Curiosity panorama entries generated from `BOXWORK_PANORAMAS`).

## Using markers

- Markers are on when the app opens. Use **Markers on/off** to hide or show them.
- Search matches a spot's name, type, mission, category, note, and tags. The category selector narrows the list further; each selected tag is an additional required match.
- Select a spot in the list or click its map pin. The selected pin gets a label, the info card opens, and the camera flies to it from above. The Gale boxwork target is selected automatically after the initial load flight.
- The card includes coordinates, MOLA elevation when the local server can provide it, distance from Gale landing, HiRISE coverage, and a NASA source link. Panorama spots also show Sol, site, drive identifier, heading, and projection type.

## Panorama cluster

Eight Curiosity Navcam panorama spots form a compact traverse cluster in Gale crater, at sites 115–119. Their waypoint positions span roughly 1.5 km. The entries cover Sols **4512, 4525, 4548, 4561, 4580, 4611, 4647, and 4671**.

Each panorama spot's source link opens its NASA resource page. Those pages describe a **360° cylindrical projection** captured by Curiosity's Right Navigation Camera. The app currently uses the projection metadata and links to identify the panorama; it does **not** render an interactive panorama viewer or use the projection as the card photograph.

Instead, the panorama cards currently share one nearby regular photo: a Curiosity MAHLI mosaic of boxwork nodules from Sol 4636. The card image links to its [NASA/JPL photojournal source](https://science.nasa.gov/photojournal/curiosity-studies-nodules-on-boxwork-formations/). This is representative imagery for the cluster, not an image matched separately to every waypoint. The waypoint's own panorama remains available through its NASA source link, for example [Sol 4512](https://science.nasa.gov/resource/sol-4512-right-navigation-camera-cylindrical-projection/) and [Sol 4671](https://science.nasa.gov/resource/sol-4671-right-navigation-camera-cylindrical-projection/).

## VR-enabled spots

`vrEnabled: true` marks a spot as eligible for a future street-view/VR experience. It currently adds a **VR** badge to the sidebar entry and shows an **Open street view** button on the card. Clicking the button only reports that street-view mode is planned; it does not open a scene. There is no WebXR or panorama navigation implementation in the marker feature yet.

The Gale boxwork target and all eight panorama spots are currently marked VR-enabled. Other landing-site spots are not. VR-enabled does not mean the displayed photo is a panorama: the panorama cluster's card image is the regular Sol 4636 MAHLI close-up described above.

## Spot data fields

Spot records are JavaScript objects in `SPOTS`. Common fields:

| Field | Purpose |
|---|---|
| `id`, `name` | Stable identifier and display name. |
| `lon`, `lat` | Pin position in degrees. Some target pins are explicitly approximate. |
| `type`, `mission`, `date`, `note` | Card description and context. |
| `category`, `tags` | Sidebar filters. A selected tag must be present for a spot to match. |
| `image`, `imageAlt`, `imageCredit`, `imageSource` | Card photo, accessible description, credit text, and linked image source. These are optional. |
| `source`, `url` | Primary source link shown in the card. For panorama spots, this opens the matching NASA panorama resource page. |
| `vrEnabled` | Adds the VR badge and placeholder street-view button. It does not enable a VR scene. |
| `sol`, `site`, `drive`, `projection`, `heading` | Optional panorama metadata displayed in the card. |

When adding a panorama spot, use a NASA waypoint for the same site/drive as its map position, include the NASA resource URL as the primary source, and describe whether the coordinate is approximate. The image can be any suitable ordinary surface photograph; it does not have to be the 360° panorama.

## References

- [NASA Sol 4512 Right Navcam cylindrical projection](https://science.nasa.gov/resource/sol-4512-right-navigation-camera-cylindrical-projection/)
- [NASA Sol 4671 Right Navcam cylindrical projection](https://science.nasa.gov/resource/sol-4671-right-navigation-camera-cylindrical-projection/)
- [NASA Curiosity studies nodules on boxwork formations (Sol 4636 MAHLI mosaic)](https://science.nasa.gov/photojournal/curiosity-studies-nodules-on-boxwork-formations/)
