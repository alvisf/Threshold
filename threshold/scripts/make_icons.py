"""Draw Threshold icons: amber bucket, sage fill, charcoal background. Run: python3 scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

BG = (24, 26, 27)
AMBER = (212, 163, 115)
SAGE = (132, 165, 157)
ROOT = Path(__file__).resolve().parent.parent / "public"


def draw(size: int, pad: float) -> Image.Image:
    s = size * 4
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    inner = s * (1 - 2 * pad)
    ox = oy = s * pad

    def pt(x: float, y: float) -> tuple[float, float]:
        return ox + x * inner, oy + y * inner

    top, bottom = 0.30, 0.84
    body = [pt(0.16, top), pt(0.84, top), pt(0.73, bottom), pt(0.27, bottom)]
    lvl = 0.52
    # Width of the bucket at the fill level, by linear interpolation along the sides.
    f = (lvl - top) / (bottom - top)
    fill = [pt(0.16 + 0.11 * f, lvl), pt(0.84 - 0.11 * f, lvl), pt(0.73, bottom), pt(0.27, bottom)]
    d.polygon(fill, fill=SAGE)
    w = max(4, int(inner * 0.045))
    d.line(body + [body[0]], fill=AMBER, width=w, joint="curve")
    x0, y0 = pt(0.24, 0.10)
    x1, y1 = pt(0.76, 0.50)
    d.arc([x0, y0, x1, y1], start=200, end=340, fill=AMBER, width=w)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    icons = ROOT / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    for n in (192, 512):
        draw(n, 0.10).save(icons / f"icon-{n}.png")
        draw(n, 0.20).save(icons / f"maskable-{n}.png")
    draw(180, 0.12).save(ROOT / "apple-touch-icon.png")
    draw(64, 0.06).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])


if __name__ == "__main__":
    main()
