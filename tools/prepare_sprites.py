"""Copies the game's own cursor, pickaxe and gold sprites into the site, blown up with
nearest-neighbour only so every art pixel stays square.

Run from anywhere: python tools/prepare_sprites.py
Source is the Unity project next to this repo on the Desktop.
"""
from pathlib import Path
from PIL import Image

SITE = Path(__file__).resolve().parent.parent
GAME = SITE.parent / "conquer" / "Assets" / "_Project" / "Art" / "Sprites" / "Used" / "Cut"
OUT = SITE / "assets" / "sprites"

POINTER_SCALE = 2   # the game draws its pointer one step below the island's zoom
TOOL_SCALE = 3      # and the tool at the island's zoom (3 at 1080p)
GOLD_SCALE = 2


def blown(path, scale):
    im = Image.open(path).convert("RGBA")
    return im.resize((im.width * scale, im.height * scale), Image.NEAREST)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    for pose in ("", "_bending", "_pressed"):
        blown(GAME / "Ui" / f"ui_cursor_hand{pose}.png", POINTER_SCALE).save(OUT / f"hand{pose}.png")

    frames = [blown(GAME / "Items" / f"cursor_pickaxe_gold_{i}.png", TOOL_SCALE) for i in range(8)]
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h))
    for i, frame in enumerate(frames):
        sheet.alpha_composite(frame, (i * w, 0))
    sheet.save(OUT / "pickaxe_gold.png")

    blown(GAME / "Items" / "drop_gold.png", GOLD_SCALE).save(OUT / "gold.png")
    print("frame", w, h, "->", OUT)


if __name__ == "__main__":
    main()
