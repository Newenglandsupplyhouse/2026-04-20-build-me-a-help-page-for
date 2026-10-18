from PIL import Image, ImageDraw, ImageFont, ImageOps
import sys
ORANGE=(224,122,31); NAVY=(27,39,51); FOOT=(19,41,61); BADGE=(244,247,250); GREY=(209,212,214); MUTED=(100,110,120)
B="/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"; R="/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
S=2000
unit = Image.open("product-photos/png-transparent/09-dual-cat-new-full.png").convert("RGBA")
gask = Image.open(sys.argv[1]).convert("RGBA")
def card(brand, out, l1=None, l2=None):
    im=Image.new("RGB",(S,S),"white"); d=ImageDraw.Draw(im)
    d.rectangle((0,0,S,14), fill=ORANGE)
    d.text((110,110),"WHAT'S INCLUDED", font=ImageFont.truetype(B,46), fill=ORANGE, spacing=4)
    tf=ImageFont.truetype(B,92)
    d.text((110,185),l1 or f"{brand} Wood Chipper", font=tf, fill=NAVY)
    d.text((110,295),l2 or "Catalytic Converter Rebuild", font=tf, fill=NAVY)
    d.line((110,440,S-110,440), fill=GREY, width=3)
    # rebuilt unit, left
    u=ImageOps.contain(unit,(760,1180)); im.paste(u,(150,520),u)
    cap=ImageFont.truetype(B,40); sub=ImageFont.truetype(R,34)
    d.text((150,1725),"Rebuilt converter", font=cap, fill=NAVY)
    d.text((150,1775),"New ceramic substrates installed", font=sub, fill=MUTED)
    # gaskets inset, right, on a soft panel
    d.rounded_rectangle((1010,520,1890,1320), radius=40, fill=BADGE)
    g=ImageOps.contain(gask,(720,640)); im.paste(g,(1010+(880-g.width)//2, 520+(800-g.height)//2), g)
    d.text((1010,1360),"2 new flange gaskets", font=cap, fill=NAVY)
    d.text((1010,1410),"Fel-Pro 61457, inlet and outlet", font=sub, fill=MUTED)
    # badges
    bf=ImageFont.truetype(B,34); x=1010
    for t in ("OEM Quality",):
        w=d.textlength(t,font=bf)+120
        d.rounded_rectangle((x,1540,x+w,1620), radius=40, fill=BADGE)
        d.ellipse((x+40,1570,x+60,1590), fill=ORANGE); d.text((x+80,1560),t,font=bf,fill=NAVY); x+=w+30
    # footer
    d.rectangle((0,S-130,S,S), fill=FOOT)
    d.text((110,S-90),"NEW ENGLAND SUPPLY HOUSE", font=ImageFont.truetype(B,40), fill="white")
    ff=ImageFont.truetype(R,34); t="(774) 701-6374 · newenglandsupplyhouse.com"
    d.text((S-110-d.textlength(t,font=ff),S-86),t,font=ff,fill=(207,224,240))
    im.save(out, quality=90, optimize=True, progressive=True); print(out)
if len(sys.argv)>2 and sys.argv[2]=="generic":
    card("", "product-photos/included-cards/included-replacement.jpg", "Catalytic Converter Rebuild", "Bandit, Morbark & Vermeer Chippers")
else:
    for b in ("Bandit","Morbark","Vermeer"):
        card(b, f"product-photos/included-cards/included-{b.lower()}.jpg")
