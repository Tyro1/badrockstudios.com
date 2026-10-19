"""Builds assets/presskit.zip: the logo, the app icon, the screenshots and the store copy,
for press and creators. Run after the screenshots or the logo change:
    python tools/build_presskit.py
"""
import zipfile
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
GAME = SITE.parent / "conquer" / "Assets" / "_Project"
OUT = SITE / "assets" / "presskit.zip"

FACTS = """Smash & Settle
by Bad Rock Studio (Istanbul)

Release: November 2026, on Steam
Platform: Windows PC (Steam)
Interface languages: English, German, French, Spanish, Brazilian Portuguese, Russian,
Turkish, Japanese, Korean, Simplified Chinese, Thai
Contact: contact@badrockstudios.com
Steam: https://store.steampowered.com/app/5304720/
Website: https://badrockstudios.com
Steam group: https://steamcommunity.com/groups/badrockstudio

Short description
An idle clicker about one very busy cursor. Click trees and rocks, build huts, hand every
chore to your hungry villagers, buy and explore island after island and help the locals,
while monsters and their creeping corruption try to take it all back.

Click everything
Trees, rocks, ore veins, giant chests that fall from the sky. Hit them yourself and sweep
the loot up with your cursor.

Hand the work over
Give each villager a job and step back. They chop, mine, gather and haul the loot home on
their own, and every island you own keeps running while you're away on another.

Buy the next island
Every island brings new resources, new tools to forge and new trouble.

Clear the nests
Nobody knows what lives in the nests. Only that the creatures keep coming, and the purple
keeps spreading, one island at a time. Gather your soldiers, pull the lever and tear the
nest out at the root.

Features
- Active when you want, idle when you don't
- No prestige, no resets: every island you buy stays yours
- Skills that add new behaviours, not just bigger numbers
- Puzzles, blessing shrines and villagers who want their lost things back

Pixel art: scale screenshots by whole numbers with nearest-neighbour filtering only,
so the pixels stay sharp.
"""


# The Smash & Settle logo (2026-10-19, the rename), as Steam's library shows it, and the Steam
# pictures made from the capsule art.
CAPSULES = GAME.parent.parent / "Steam" / "Capsules"
CAPSULE_FILES = ["main_capsule_1232x706.png", "header_capsule_920x430.png",
                 "library_hero_3840x1240.png"]


def main():
    logo = next(CAPSULES.glob("library_logo_*.png"))

    root = "Smash and Settle - press kit"
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{root}/fact_sheet.txt", FACTS)
        z.write(logo, f"{root}/logo/logo_transparent.png")
        z.write(GAME / "Art" / "Icons" / "App" / "app_icon_1024.png", f"{root}/logo/app_icon_1024.png")
        for name in CAPSULE_FILES:
            z.write(CAPSULES / name, f"{root}/key_art/{name}")
        for shot in sorted((SITE / "assets" / "shots").glob("*.png")):
            z.write(shot, f"{root}/screenshots/{shot.name}")
    print(OUT, OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
