"""Generates the placeholder evidence images used by sample-findings.js into ./sample-assets/.

These are deliberately illustrations, each stamped "SAMPLE IMAGE", not photographs — they must
never be mistaken for real field evidence. Usage: python make-sample-photos.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample-assets")
os.makedirs(OUT, exist_ok=True)


def font(size, bold=False):
    for name in ("arialbd.ttf" if bold else "arial.ttf", "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def vgrad(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def stamp(img, text):
    w, h = img.size
    d = ImageDraw.Draw(img, "RGBA")
    bar = int(h * 0.075)
    d.rectangle([0, h - bar, w, h], fill=(11, 37, 69, 215))
    f = font(int(bar * 0.5), bold=True)
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, h - bar + bar * 0.24), text, font=f, fill=(255, 255, 255))
    return img


W, H = 1280, 960


def scene(name, sky, ground, draw_fn, label):
    img = vgrad(W, H, sky[0], sky[1])
    d = ImageDraw.Draw(img, "RGBA")
    horizon = int(H * 0.62)
    d.rectangle([0, horizon, W, H], fill=ground)
    d.ellipse([W * 0.78, H * 0.08, W * 0.78 + 150, H * 0.08 + 150], fill=(255, 236, 170, 235))  # sun
    draw_fn(d, horizon)
    stamp(img, f"SAMPLE IMAGE  -  {label}")
    img.save(os.path.join(OUT, name), quality=88)


def wash(d, hz):  # hand pump beside a puddle, out of order
    d.ellipse([230, hz + 90, 720, hz + 230], fill=(96, 140, 170, 200))          # puddle
    d.rectangle([840, hz - 330, 880, hz + 90], fill=(64, 72, 82))                 # pump column
    d.rectangle([790, hz - 350, 1010, hz - 315], fill=(64, 72, 82))               # head
    d.polygon([(1010, hz - 350), (1150, hz - 215), (1120, hz - 190), (985, hz - 315)], fill=(64, 72, 82))  # handle
    d.rectangle([800, hz + 90, 920, hz + 130], fill=(120, 120, 120))              # base
    d.line([(810, hz - 120), (870, hz - 60)], fill=(210, 60, 60), width=14)       # tape / fault
    d.line([(870, hz - 120), (810, hz - 60)], fill=(210, 60, 60), width=14)


def nutrition(d, hz):  # empty shelf with a few cartons
    d.rectangle([250, hz - 360, 1030, hz + 60], fill=(120, 84, 52))
    for y in (hz - 360, hz - 210, hz - 60):
        d.rectangle([250, y, 1030, y + 24], fill=(84, 58, 36))
    d.rectangle([300, hz - 330, 400, hz - 240], fill=(232, 168, 60))
    d.rectangle([860, hz - 180, 980, hz - 90], fill=(232, 168, 60))
    d.text((600, hz - 130), "EMPTY", font=font(64, True), fill=(255, 255, 255, 200))


def protection(d, hz):  # locked complaint box on a post
    d.rectangle([610, hz - 40, 660, hz + 200], fill=(84, 58, 36))                 # post
    d.rounded_rectangle([470, hz - 300, 800, hz - 40], 18, fill=(46, 125, 155))   # box
    d.rectangle([600, hz - 210, 670, hz - 190], fill=(20, 40, 60))                # slot
    d.rounded_rectangle([610, hz - 140, 660, hz - 90], 8, fill=(242, 166, 90))    # padlock body
    d.arc([615, hz - 190, 655, hz - 130], 180, 360, fill=(242, 166, 90), width=8)  # shackle
    d.text((528, hz - 282), "COMPLAINTS", font=font(36, True), fill=(255, 255, 255))


def health(d, hz):  # small clinic building
    d.rectangle([260, hz - 300, 1020, hz + 40], fill=(236, 232, 222))
    d.polygon([(230, hz - 300), (640, hz - 420), (1050, hz - 300)], fill=(150, 78, 62))
    d.rectangle([590, hz - 170, 700, hz + 40], fill=(90, 70, 52))                 # door
    for x in (340, 800):
        d.rectangle([x, hz - 220, x + 130, hz - 110], fill=(150, 200, 225))
    d.rectangle([610, hz - 300, 670, hz - 240], fill=(200, 50, 60))               # cross
    d.rectangle([630, hz - 320, 650, hz - 220], fill=(255, 255, 255))
    d.rectangle([600, hz - 280, 680, hz - 260], fill=(255, 255, 255))


scene("mov_wash.jpg", ((178, 214, 240), (232, 244, 250)), (196, 170, 128, 255), wash, "MOV photo (WASH)")
scene("mov_nutrition.jpg", ((196, 222, 238), (240, 240, 232)), (176, 160, 130, 255), nutrition, "MOV photo (Nutrition)")
scene("mov_protection.jpg", ((186, 218, 240), (236, 244, 246)), (168, 152, 118, 255), protection, "MOV photo (Protection)")
scene("mov_health.jpg", ((170, 208, 238), (228, 240, 250)), (190, 168, 124, 255), health, "MOV photo (Health)")

# Selfie portraits: neutral silhouette, three background tones (reporter / two DRIs)
for name, (top, bottom), shirt in (
    ("selfie_fm.jpg", ((28, 114, 147), (11, 37, 69)), (242, 166, 90)),
    ("selfie_dri_health.jpg", ((88, 138, 118), (28, 70, 60)), (236, 236, 236)),
    ("selfie_dri_wash.jpg", ((120, 110, 160), (48, 44, 84)), (90, 180, 200)),
):
    w, h = 960, 1280
    img = vgrad(w, h, top, bottom)
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([w * 0.18, h * 0.60, w * 0.82, h * 1.25], fill=shirt)                       # shoulders
    d.rectangle([w * 0.43, h * 0.50, w * 0.57, h * 0.66], fill=(176, 128, 96))             # neck
    d.ellipse([w * 0.32, h * 0.22, w * 0.68, h * 0.56], fill=(190, 140, 106))              # head
    d.ellipse([w * 0.31, h * 0.20, w * 0.69, h * 0.36], fill=(40, 30, 28))                  # hair
    stamp(img, "SAMPLE IMAGE  -  selfie")
    img.save(os.path.join(OUT, name), quality=88)

# RUTF sachets given at an OTP visit (seed-demo-otp-followup.js): packets only, no people.
img = Image.new("RGB", (960, 720), (236, 231, 220))
d = ImageDraw.Draw(img)
d.rectangle([0, 396, 960, 720], fill=(196, 168, 128))                                       # table
for r in range(3):
    for c in range(7):
        x, y = 90 + c * 115 + (r % 2) * 20, 150 + r * 130
        d.rounded_rectangle([x, y, x + 95, y + 120], radius=10, fill=(250, 250, 248), outline=(180, 40, 40), width=4)
        d.rectangle([x + 8, y + 20, x + 87, y + 55], fill=(200, 45, 45))
        d.text((x + 18, y + 28), "RUTF", font=font(22, True), fill="white")
        d.text((x + 22, y + 70), "92 g", font=font(18), fill=(90, 90, 90))
stamp(img, "SAMPLE IMAGE  -  RUTF sachets (no people)")
img.save(os.path.join(OUT, "rutf_sachets.jpg"), quality=85)

print("wrote", sorted(os.listdir(OUT)))
