# Warp logo SVGs (improved)

Source PNG: `Adobe Express - file (1) (1).png`

The Adobe auto-trace in the old single-line SVG lost fills on dark fade tiles (near-black paths on black).

**Fixed versions** rebuild the W as a **solid pixel grid** (opaque `<rect>` tiles):

| File | Use |
|------|-----|
| `warp-w-transparent.svg` | Transparent background, solid gray→white tiles |
| `warp-w.svg` | Same on black background |
| `warp-w-mono.svg` | Compact monochrome for activity bar experiments |

Every visible square has a full solid fill (minimum ~#9a9a9a so fade particles never disappear).