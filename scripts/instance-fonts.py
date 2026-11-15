import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
src, out = sys.argv[1], sys.argv[2]
jobs = [
  ("Fraunces.ttf", dict(opsz=48, wght=340, SOFT=100, WONK=0), "WaliDisplay", "Regular"),
  ("Fraunces-Italic.ttf", dict(opsz=48, wght=340, SOFT=100, WONK=1), "WaliDisplay-Italic", "Italic"),
  ("Figtree.ttf", dict(wght=400), "WaliText-Regular", "Regular"),
  ("Figtree.ttf", dict(wght=500), "WaliText-Medium", "Medium"),
  ("Figtree.ttf", dict(wght=600), "WaliText-SemiBold", "SemiBold"),
]
for f, loc, ps, sub in jobs:
    font = instantiateVariableFont(TTFont(f"{src}/{f}"), loc)
    fam = ps.split("-")[0]
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 25):
            name.removeNames(nameID=rec.nameID)
    for nid, val in {1: ps, 2: "Regular", 3: ps, 4: ps, 6: ps, 16: fam, 17: sub}.items():
        name.setName(val, nid, 3, 1, 0x409)
        name.setName(val, nid, 1, 0, 0)
    if "STAT" in font: del font["STAT"]
    font.save(f"{out}/{ps}.ttf")
    print(ps, loc)
