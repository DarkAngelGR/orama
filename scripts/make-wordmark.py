"""Redraw the FlexPlex wordmark into the brand images (run with python3 -I).

"Flex" in cream (or charcoal on light backgrounds) + "PLEX" in coral, set in
the app's Barlow Condensed 600 (closest to the original lettering's weight),
slightly tightened, at the size and position of the previous wordmark in each
image. The mascot artwork is left untouched. Needs Pillow, numpy and
opencv-python. Afterwards run scripts/make-brand.py to refresh
app/img/wordmark.png.
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
FONT = root / 'app' / 'fonts' / 'barlow-condensed-latin-600-normal.woff2'
TRACKING = -0.02  # em
CREAM = (255, 247, 230, 255)
CHARCOAL = (18, 20, 25, 255)
CORAL = (255, 76, 66, 255)
WORDS = ('Flex', 'PLEX')


def wordmark(height, first=CREAM, second=CORAL):
    """Tight RGBA image of the wordmark, scaled to `height` px tall."""
    size = 800
    font = ImageFont.truetype(str(FONT), size)
    chars = [(c, first) for c in WORDS[0]] + [(c, second) for c in WORDS[1]]
    im = Image.new('RGBA', (int(sum(font.getlength(c) for c, _ in chars)) + 40, 1000), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 20
    for c, color in chars:
        d.text((x, 0), c, font=font, fill=color)
        x += font.getlength(c) + TRACKING * size
    im = im.crop(im.getchannel('A').getbbox())
    return im.resize((round(im.width * height / im.height), height), Image.LANCZOS)


def place(canvas, mark, box, align='center'):
    """Paste `mark` into canvas, vertically centred in box, aligned horizontally."""
    x0, y0, x1, y1 = box
    y = y0 + ((y1 - y0) - mark.height) // 2
    x = x0 if align == 'left' else x0 + ((x1 - x0) - mark.width) // 2
    canvas.alpha_composite(mark, (x, y)) if canvas.mode == 'RGBA' else canvas.paste(mark, (x, y), mark)


def transparent_wordmark(name, first):
    path = root / 'assets' / 'brand' / name
    old = Image.open(path).convert('RGBA')
    box = old.getchannel('A').getbbox()
    out = Image.new('RGBA', old.size, (0, 0, 0, 0))
    place(out, wordmark(box[3] - box[1], first), box)
    out.save(path, optimize=True)
    print(name, out.size)


def lockup(name, first, text_left=700):
    """Mascot on the left stays; the text area right of `text_left` is redrawn."""
    path = root / 'assets' / 'brand' / name
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A')
    text = alpha.crop((text_left, 0, im.width, im.height)).getbbox()
    box = (text_left + text[0], text[1], text_left + text[2], text[3])
    im.paste((0, 0, 0, 0), (text_left, 0, im.width, im.height))
    place(im, wordmark(box[3] - box[1], first), box, align='left')
    im.save(path, optimize=True)
    print(name, 'text box', box)


def splash(path, band=(600, 660, 1320, 830)):
    """Find the wordmark (bright pixels in `band`, above the dim tagline),
    inpaint it away so the background gradient continues, then draw the new
    one centred at the same height. Safe to re-run."""
    im = Image.open(path).convert('RGB')
    a = np.array(im)
    bx0, by0, bx1, by1 = band
    region = a[by0:by1, bx0:bx1]
    text = region.max(axis=2) > 150
    ys, xs = np.nonzero(text)
    box = (bx0 + xs.min(), by0 + ys.min(), bx0 + xs.max(), by0 + ys.max())
    mask = np.zeros(a.shape[:2], np.uint8)
    mask[by0:by1, bx0:bx1] = text.astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))  # catch anti-aliased edges
    clean = cv2.inpaint(cv2.cvtColor(a, cv2.COLOR_RGB2BGR), mask, 9, cv2.INPAINT_TELEA)
    im = Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))
    mark = wordmark(box[3] - box[1])
    im.paste(mark, ((im.width - mark.width) // 2, box[1]), mark)
    im.save(path, optimize=True)
    print(path.relative_to(root), 'old text box', box)


transparent_wordmark('wordmark-light-1600x400.png', CREAM)
transparent_wordmark('wordmark-dark-1600x400.png', CHARCOAL)
lockup('lockup-horizontal-light-1920x640.png', CREAM)
lockup('lockup-horizontal-dark-1920x640.png', CHARCOAL)
splash(root / 'app' / 'img' / 'splash.png')
