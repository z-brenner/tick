"""Tick icon: a usage bar with a pace tick, on a clay tile. Usage: python3 make_icons.py <out_dir>"""
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
S = 1024


def draw():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    top, bot = (222, 128, 96), (190, 88, 56)
    for y in range(S):
        t = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=255)
    im.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(im)
    x0, x1 = S * 0.17, S * 0.83
    th = S * 0.17                      # track thickness
    cy = S * 0.5
    r = th / 2
    # track
    d.rounded_rectangle([x0, cy - r, x1, cy + r], radius=r, fill=(255, 255, 255, 80))
    # fill, under pace
    fx = x0 + (x1 - x0) * 0.48
    d.rounded_rectangle([x0, cy - r, fx, cy + r], radius=r, fill=(255, 255, 255, 255))
    # the tick: where even pace would be
    tx = x0 + (x1 - x0) * 0.74
    tw, tlen = S * 0.085, S * 0.48
    d.rounded_rectangle([tx - tw / 2, cy - tlen / 2, tx + tw / 2, cy + tlen / 2], radius=tw / 2, fill=(255, 255, 255, 255))
    return im


big = draw()
for n in (16, 32, 48, 128):
    big.resize((n, n), Image.LANCZOS).save(f"{out}/icon{n}.png")
big.resize((512, 512), Image.LANCZOS).save(f"{out}/icon512.png")
print('ok')
