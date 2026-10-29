"""Generate every Orama logo image from one drawing (run with python3 -I).

The mark ("Fast Forward"): two rounded play arrows, white then violet, on an
ink tile. The wordmark: "Or" + violet "ama" in the app's Outfit 600. Shapes are drawn 4x oversized and scaled down, so every size
is crisp; only Pillow is needed.

Writes the app's icon, header/sign-in/splash images and the brand set under
assets/.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
FONT = root / 'app' / 'fonts' / 'outfit-latin-600-normal.woff2'

BG = (11, 11, 18)            # app background #0B0B12
TILE = (23, 23, 36)          # #171724 (--raised)
CREAM = (244, 243, 255)      # #F4F3FF (--cream)
ACCENT = (139, 124, 255)     # #8B7CFF (--accent)
CHARCOAL = (17, 17, 28)      # wordmark on light backgrounds
TAGLINE = (164, 161, 190)
TAGLINE_TEXT = 'A FAST PLAYER FOR YOUR LIBRARY'
SS = 4                        # supersampling factor

# The mark, in a 120x120 design grid (matches the design canvas).
ARROWS = [
    ([(28, 38), (54, 60), (28, 82)], CREAM),
    ([(64, 38), (90, 60), (64, 82)], ACCENT),
]
STROKE = 8      # rounds the arrow corners
RADIUS = 28     # tile corner radius


def rgba(c):
    return c + (255,) if len(c) == 3 else c


def mark(size, rounded=True, bg=TILE, arrows=None, tile=True):
    """The icon at size x size px. rounded=False: a full square (for launchers
    that apply their own mask). arrows / tile=False draw only some of it (the
    splash animates its pieces separately)."""
    big = size * SS
    k = big / 120
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if not tile:
        pass
    elif rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * k, fill=rgba(bg))
    else:
        d.rectangle([0, 0, big, big], fill=rgba(bg))
    for pts, color in (ARROWS if arrows is None else arrows):
        p = [(x * k, y * k) for x, y in pts]
        d.polygon(p, fill=rgba(color))
        d.line(p + p[:2], fill=rgba(color), width=round(STROKE * k), joint='curve')
        r = STROKE * k / 2
        for x, y in p:  # round the vertices fully
            d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(color))
    return im.resize((size, size), Image.LANCZOS)


def wordmark(height, first=CREAM, second=ACCENT, tracking=-0.03):
    size = 800
    font = ImageFont.truetype(str(FONT), size)
    chars = [(c, first) for c in 'Or'] + [(c, second) for c in 'ama']
    im = Image.new('RGBA', (int(sum(font.getlength(c) for c, _ in chars)) + 40, 1000), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 20
    for c, color in chars:
        d.text((x, 0), c, font=font, fill=rgba(color))
        x += font.getlength(c) + tracking * size
    im = im.crop(im.getchannel('A').getbbox())
    return im.resize((round(im.width * height / im.height), height), Image.LANCZOS)


def text(s, height, color, tracking=0.04):
    size = 400
    font = ImageFont.truetype(str(FONT), size)
    w = int(sum(font.getlength(c) for c in s) + tracking * size * len(s)) + 40
    im = Image.new('RGBA', (w, 600), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 20
    for c in s:
        d.text((x, 0), c, font=font, fill=rgba(color))
        x += font.getlength(c) + tracking * size
    im = im.crop(im.getchannel('A').getbbox())
    return im.resize((round(im.width * height / im.height), height), Image.LANCZOS)


def backdrop(w, h):
    """Charcoal with a faint lift in the middle (computed small, scaled up)."""
    sw, sh = 192, max(1, round(192 * h / w))
    im = Image.new('RGB', (sw, sh))
    px = im.load()
    cx, cy = sw / 2, sh * 0.45
    far = ((cx ** 2) + (cy ** 2)) ** 0.5
    centre = (27, 25, 44)
    for y in range(sh):
        for x in range(sw):
            t = min(1, (((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) / far)
            t = t * t * (3 - 2 * t)
            px[x, y] = tuple(round(centre[i] * (1 - t) + BG[i] * t) for i in range(3))
    return im.resize((w, h), Image.BICUBIC).convert('RGBA')


def save(im, rel, mode=None, **kw):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if mode:
        im = im.convert(mode)
    im.save(path, optimize=True, **kw)
    print(rel, im.size, im.mode)


def splash(w, h):
    im = backdrop(w, h)
    s = h / 1080
    icon = mark(round(300 * s))
    im.alpha_composite(icon, ((w - icon.width) // 2, round(230 * s)))
    wm = wordmark(round(92 * s))
    im.alpha_composite(wm, ((w - wm.width) // 2, round(640 * s)))
    tag = text(TAGLINE_TEXT, round(24 * s), TAGLINE, tracking=0.2)
    im.alpha_composite(tag, ((w - tag.width) // 2, round(800 * s)))
    return im


def lockup(w, h, first, bg=None):
    im = Image.new('RGBA', (w, h), rgba(bg) if bg else (0, 0, 0, 0))
    icon = mark(round(h * 0.66))
    wm = wordmark(round(h * 0.31), first)
    gap = round(h * 0.16)
    x = (w - (icon.width + gap + wm.width)) // 2
    im.alpha_composite(icon, (x, (h - icon.height) // 2))
    im.alpha_composite(wm, (x + icon.width + gap, (h - wm.height) // 2))
    return im


# --- the app ------------------------------------------------------------------
save(mark(512, rounded=False), 'app/icon-orama.png', 'RGB')        # TV launcher icon
save(mark(160), 'app/img/logo-mark.png')                      # home header (shown 80x80)
save(mark(560), 'app/img/logo-560.png')                       # sign-in screen
save(wordmark(96), 'app/img/wordmark.png')                    # home header (shown 44 tall)
save(splash(1920, 1080), 'app/img/splash.png', 'RGB')
# The animated splash (index.html + css "splash"): the same picture in pieces.
# Placed at: tile and arrows (810, 230) 300x300, wordmark centred at y 640,
# tagline centred at y 800, on a 192x108 backdrop the GPU stretches.
save(backdrop(192, 108), 'app/img/splash/bg.png', 'RGB')
save(mark(300, arrows=[]), 'app/img/splash/tile.png')
save(mark(300, arrows=ARROWS[:1], tile=False), 'app/img/splash/arrow1.png')
save(mark(300, arrows=ARROWS[1:], tile=False), 'app/img/splash/arrow2.png')
save(wordmark(92), 'app/img/splash/word.png')
save(text(TAGLINE_TEXT, 24, TAGLINE, tracking=0.2), 'app/img/splash/tag.png')

# --- brand set ------------------------------------------------------------------
save(lockup(1920, 640, CREAM), 'assets/brand/lockup-horizontal-light-1920x640.png')
save(lockup(1920, 640, CHARCOAL), 'assets/brand/lockup-horizontal-dark-1920x640.png')
for name, color in (('light', CREAM), ('dark', CHARCOAL)):
    canvas = Image.new('RGBA', (1600, 400), (0, 0, 0, 0))
    wm = wordmark(226, color)
    canvas.alpha_composite(wm, ((1600 - wm.width) // 2, (400 - wm.height) // 2))
    save(canvas, f'assets/brand/wordmark-{name}-1600x400.png')
save(mark(1024), 'assets/brand/logo-mark-1024.png')
for n in (117, 128, 256, 512, 1024):
    save(mark(n, rounded=False), f'assets/icons/app-icon-{n}.png', 'RGB')
save(splash(1920, 1080), 'assets/splash/splash-1920x1080.png', 'RGB')
save(splash(1280, 720), 'assets/splash/splash-1280x720.png', 'RGB')
save(lockup(1920, 480, CREAM, BG), 'assets/splash/banner-1920x480.png', 'RGB')
save(lockup(1280, 320, CREAM, BG), 'assets/splash/banner-1280x320.png', 'RGB')

# Samsung Seller Office / Tizen Studio formats (see assets/README.md)
save(mark(117, rounded=False), 'assets/tizen/icon-dev-117x117.png', 'RGB')
seller = backdrop(512, 423)
icon = mark(300)
seller.alpha_composite(icon, ((512 - 300) // 2, (423 - 300) // 2))
save(seller, 'assets/tizen/seller-icon-512x423.png', 'RGB')
layer = lockup(1920, 1080, CREAM)
save(layer, 'assets/tizen/seller-logo-layer-1920x1080.png')
bg = backdrop(1920, 1080)
save(bg, 'assets/tizen/seller-background-1920x1080.jpg', 'RGB', quality=90)
bg.alpha_composite(layer)
save(bg, 'assets/tizen/seller-combined-preview-1920x1080.png', 'RGB')
