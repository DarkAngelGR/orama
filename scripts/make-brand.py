"""Trimmed, display-sized brand images for the app header (run with python3 -I)."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'app' / 'img'


def trim(src, height, dest):
    im = Image.open(root / src).convert('RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    w = round(im.width * height / im.height)
    im.resize((w, height), Image.LANCZOS).save(out / dest, optimize=True)
    print(dest, (w, height))


trim('assets/brand/wordmark-light-1600x400.png', 96, 'wordmark.png')
trim('assets/brand/mascot-transparent-256.png', 168, 'mascot.png')
