# SamSUCKS branding assets

Production-ready PNG branding for the SamSUCKS Samsung Tizen TV app. The visual system uses a charcoal television mascot, angry face, coral pirate eye patch, warm cream highlights, and a condensed `SamSUCKS` wordmark.

## Start here

- `tizen/icon-dev-117x117.png` — development/package icon used while testing a TV app in Tizen Studio.
- `tizen/seller-logo-layer-1920x1080.png` — transparent RGBA logo layer for Samsung Seller Office.
- `tizen/seller-background-1920x1080.jpg` — separate RGB background for the 1920×1080 Seller Office icon.
- `tizen/seller-icon-512x423.png` — flattened RGB store icon.
- `tizen/seller-combined-preview-1920x1080.png` — preview only; shows the logo layer over the background.
- `splash/splash-1920x1080.png` — recommended full-HD in-app splash artwork.
- `preview/asset-preview.png` — quick visual index of the set.

## Verified Samsung TV requirements

Checked against Samsung Developer documentation on October 10, 2026:

| Purpose | Samsung requirement | Included file |
| --- | --- | --- |
| Tizen Studio testing icon | 117×117 PNG | `tizen/icon-dev-117x117.png` |
| Seller Office logo layer | 1920×1080, 32-bit PNG (RGBA), under 300 KB | `tizen/seller-logo-layer-1920x1080.png` |
| Seller Office background | 1920×1080, 24-bit PNG (RGB) or JPG, under 300 KB | `tizen/seller-background-1920x1080.jpg` |
| Seller Office alternate icon | 512×423, 24-bit PNG (RGB), under 300 KB | `tizen/seller-icon-512x423.png` |

Samsung also recommends designing TV application screens at 1920×1080 in a 16:9 aspect ratio. The 1280×720 splash is supplied as a convenience for FHD testing.

Official references:

- https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html
- https://developer.samsung.com/smarttv/design/smart-tv-application-design-qa.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/managing-screen-resolution.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html

## Directory map

```text
SamSUCKS/
├── brand/     Transparent mascot, wordmark, and horizontal lockups
├── icons/     General-purpose square RGB app icons
├── preview/   Contact sheet for visual review
├── source/    Original generated mascot and normalized transparent master
├── splash/    16:9 splash screens and wide banners
└── tizen/     Samsung/Tizen-specific deliverables
```

## Using the development icon

Copy `tizen/icon-dev-117x117.png` into the root of the Tizen web project as `icon.png`, then point `config.xml` to it:

```xml
<icon src="icon.png" />
```

The 117×117 icon is for development/testing. For a published TV app, upload the separate Seller Office assets listed above.

## Brand usage

- Primary background: `#0B0D12`
- Raised charcoal: `#181B23`
- Coral accent: `#FF4C42`
- Warm cream: `#FFF7E6`
- Keep the mascot fully visible with breathing room; do not crop the antenna tips or eye patch.
- Use the light wordmark on dark backgrounds and the dark wordmark on light backgrounds.
- The splash and banner files are application artwork, not mandatory Seller Office submission images.

## Notes

All PNG dimensions and color modes were validated after export. The Seller Office assets are under Samsung's 300 KB file-size ceiling. The mascot is original project artwork generated for SamSUCKS; the wordmark is rasterized into the PNG files.
