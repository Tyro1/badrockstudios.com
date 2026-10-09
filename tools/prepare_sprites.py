"""Copies the game's own drawings into the site, blown up with nearest-neighbour only so
every art pixel stays square: the cursor, the swing tools, the gold, the title logo with the
hand that taps it, the lagoon's gulls, the animals and villagers that walk the shore, and the
lagoon tile in each of the colours the shop sells.

Run from anywhere: python tools/prepare_sprites.py
Source is the Unity project next to this repo on the Desktop.
"""
from pathlib import Path
from PIL import Image

SITE = Path(__file__).resolve().parent.parent
GAME = SITE.parent / "conquer" / "Assets" / "_Project" / "Art" / "Sprites" / "Used"
CUT = GAME / "Cut"
OUT = SITE / "assets" / "sprites"
TITLE_OUT = SITE / "assets" / "title"

POINTER_SCALE = 2   # the game draws its pointer one step below the island's zoom
TOOL_SCALE = 3      # and the tool at the island's zoom (3 at 1080p)
GOLD_SCALE = 2
PET_SCALE = 3       # the shore's walkers, at the tool's size
GULL_SCALE = 4      # one gull texel to one of the page's art pixels

# Every swing the shop sells, as (tool, material). The gold pickaxe is the one you start with.
TOOLS = [
    ("pickaxe", "gold"),
    ("pickaxe", "ruby"),
    ("pickaxe", "onix"),
    ("pickaxe", "diamond"),
    ("axe", "gold"),
    ("scythe", "ruby"),
]

# The shore's walkers: (site name, game cut). Each is cropped to the box its frames share,
# feet on the bottom row, so the page can stand them all on the same line of sand.
PETS = [
    ("chick", "Creatures/animal_chicken_walk"),
    ("duck", "Creatures/animal_duck_walk"),
    ("pig", "Creatures/animal_pig_walk"),
    ("sheep", "Creatures/animal_sheep_walk"),
    ("miner", "Characters/unit_miner_walk"),
    ("lumberjack", "Characters/unit_lumberjack_walk"),
    ("slime", "Characters/unit_slime_hop"),
]

# The lagoon tile is three colours: the water, its ripples and their glints. Each shop lagoon
# swaps the three for its own; the turquoise is the game's title lagoon (TitleScreenView).
WATER = [(78, 165, 250), (118, 188, 252), (176, 219, 254)]
LAGOONS = {
    "turquoise": [(32, 178, 166), (78, 206, 190), (170, 238, 226)],
    "sunset": [(236, 122, 104), (246, 160, 126), (255, 214, 168)],
    "night": [(30, 42, 92), (50, 70, 136), (122, 152, 222)],
}


def blown(im, scale):
    if not isinstance(im, Image.Image):
        im = Image.open(im)
    im = im.convert("RGBA")
    return im.resize((im.width * scale, im.height * scale), Image.NEAREST)


def strip(frames, scale):
    """Frames side by side in one sheet, each blown up whole."""
    frames = [blown(f, scale) for f in frames]
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h))
    for i, frame in enumerate(frames):
        sheet.alpha_composite(frame, (i * w, 0))
    return sheet, (w, h)


def frames_of(stem):
    paths = sorted(CUT.glob(stem + "_[0-9].png"), key=lambda p: int(p.stem.rsplit("_", 1)[1]))
    return [Image.open(p).convert("RGBA") for p in paths]


def shared_box(frames):
    """The box every frame fits in. Its bottom is the lowest foot of any frame, so every
    walker stands on the bottom row of its sheet."""
    boxes = [f.getbbox() for f in frames if f.getbbox()]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    TITLE_OUT.mkdir(parents=True, exist_ok=True)

    for pose in ("", "_bending", "_pressed"):
        blown(CUT / "Ui" / f"ui_cursor_hand{pose}.png", POINTER_SCALE).save(OUT / f"hand{pose}.png")

    for tool, material in TOOLS:
        sheet, (w, h) = strip(frames_of(f"Items/cursor_{tool}_{material}"), TOOL_SCALE)
        sheet.save(OUT / f"{tool}_{material}.png")
    print("tool frame", w, h)

    blown(CUT / "Items" / "drop_gold.png", GOLD_SCALE).save(OUT / "gold.png")

    for name, stem in PETS:
        frames = frames_of(stem)
        box = shared_box(frames)
        sheet, size = strip([f.crop(box) for f in frames], PET_SCALE)
        sheet.save(OUT / f"pet_{name}.png")
        print("pet", name, len(frames), "frames of", size)

    gulls = [Image.open(CUT / "Ui" / f"ui_title_gull_{wing}.png") for wing in ("up", "down")]
    strip(gulls, GULL_SCALE)[0].save(OUT / "gull.png")

    # The title as the game shows it: the name, the hand pressing under it and the click's
    # strokes, three sheets on one grid, kept at one texel to an art pixel; the page scales
    # them up whole.
    for part in ("logo", "hand", "click"):
        Image.open(GAME / "Sheets" / "Title" / f"title_{part}.png").save(TITLE_OUT / f"{part}.png")

    tile = Image.open(SITE / "assets" / "water.png").convert("RGB")
    for name, colours in LAGOONS.items():
        swap = dict(zip(WATER, colours))
        out = tile.copy()
        out.putdata([swap.get(px, px) for px in tile.getdata()])
        out.save(SITE / "assets" / f"water_{name}.png")

    print("->", OUT, TITLE_OUT)


if __name__ == "__main__":
    main()
