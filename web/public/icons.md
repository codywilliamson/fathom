# icons

the fathom mark: a sounding line with depth ticks and a plumb bob — the deep-sea
instrument used to measure a fathom, doubling as the literal meaning of the name.
brass/amber (`#ffb454`) on the house void background (`#05080a`), flat inline
strokes, no gradients.

`icon.svg` and `favicon.svg` are hand-written and identical — edit those directly,
then regenerate the PNGs from them. ImageMagick's built-in svg renderer was used
(no `rsvg-convert`/`librsvg` on this machine; `convert -list delegate` still
reported an `rsvg-convert` delegate line but the binary isn't installed, so it
silently fell back to the internal MSVG renderer — verified non-empty alpha and
real pixel content on a test render before trusting it for these).

```sh
cd web/public

# app icon: rounded square, transparent corners outside the rounded rect
convert -background none icon.svg -resize 512x512 icon-512.png
convert icon-512.png -resize 192x192 icon-192.png

# maskable needs a full-bleed variant: same mark, but the rounded rect swapped
# for a full 512x512 fill (no transparent corners for the OS mask to clip into).
# the mark's furthest points sit ~166px from center, well inside the ~205px
# maskable safe-zone radius (inner 80%), so no separate "pull inward" pass needed.
cat > /tmp/fathom-maskable.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#05080a"/>
  <line x1="256" y1="88" x2="256" y2="350" stroke="#ffb454" stroke-width="14" stroke-linecap="round"/>
  <line x1="238" y1="150" x2="274" y2="150" stroke="#ffb454" stroke-width="10" stroke-linecap="round"/>
  <line x1="230" y1="210" x2="282" y2="210" stroke="#ffb454" stroke-width="10" stroke-linecap="round"/>
  <line x1="222" y1="270" x2="290" y2="270" stroke="#ffb454" stroke-width="10" stroke-linecap="round"/>
  <polygon points="256,330 302,376 256,422 210,376" fill="#ffb454"/>
</svg>
EOF
convert -background none /tmp/fathom-maskable.svg -resize 512x512 icon-512-maskable.png

# apple touch icon: full-bleed 180 (iOS rounds it itself)
convert icon-512-maskable.png -resize 180x180 apple-touch-icon.png
```
