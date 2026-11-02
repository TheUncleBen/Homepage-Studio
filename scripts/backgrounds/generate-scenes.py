# Studio's built-in scene backgrounds: original artwork drawn procedurally
# (no photographs, licences or attribution). Run with Pillow to regenerate
# homepage/public/studio-backgrounds/*.webp and their thumbnails.
#   python3 scripts/backgrounds/generate-scenes.py [output-dir/]
import random, math
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import os, sys
OUT=sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'homepage', 'public', 'studio-backgrounds') + '/'
os.makedirs(OUT, exist_ok=True)
def lerp(a,b,t): return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))
def ridge(w, base, amp, seed, rough=0.55):
    random.seed(seed); n=257; pts=[0.0]*n; pts[0]=random.uniform(-1,1); pts[-1]=random.uniform(-1,1)
    step=n-1; scale=1.0
    while step>1:
        half=step//2
        for i in range(half,n-1,step):
            pts[i]=(pts[i-half]+pts[i+half])/2+random.uniform(-1,1)*scale
        step=half; scale*=rough
    return [(x*w/(n-1), base-amp*pts[x]) for x in range(n)]
def landscape(w,h,sky_top,sky_bot,sun,layers,seed,name,haze):
    img=Image.new('RGB',(w,h)); d=ImageDraw.Draw(img)
    for y in range(h): d.line([(0,y),(w,y)],fill=lerp(sky_top,sky_bot,y/h))
    if sun:
        g=Image.new('L',(w,h),0); gd=ImageDraw.Draw(g); cx,cy,r=sun
        gd.ellipse([cx-r*3,cy-r*3,cx+r*3,cy+r*3],fill=60); gd.ellipse([cx-r,cy-r,cx+r,cy+r],fill=230)
        g=g.filter(ImageFilter.GaussianBlur(r*0.8)); img.paste(Image.new('RGB',(w,h),(255,236,200)),(0,0),g)
    for i,(col,base,amp) in enumerate(layers):
        lay=Image.new('L',(w,h),0); ld=ImageDraw.Draw(lay)
        p=ridge(w,base*h,amp*h,seed+i); ld.polygon(p+[(w,h),(0,h)],fill=255)
        blur=max(0,(len(layers)-1-i))*1.2
        if blur: lay=lay.filter(ImageFilter.GaussianBlur(blur))
        img.paste(Image.new('RGB',(w,h),lerp(col,haze,0.0)),(0,0),lay)
    random.seed(seed); px=img.load()
    for _ in range(w*h//3):
        x=random.randrange(w); y=random.randrange(h); v=random.randint(-9,9); r,g,b=px[x,y]; px[x,y]=(max(0,min(255,r+v)),max(0,min(255,g+v)),max(0,min(255,b+v)))
    save(img, name)

W, H = 1600, 1000

def save(img, name):
    """Saves a scene as WebP plus a 480x300 thumbnail for the picker."""
    stem = name.rsplit('.', 1)[0].replace('bg-', '')
    img.save(OUT + stem + '.webp', 'WEBP', quality=78, method=6)
    img.resize((480, 300), Image.LANCZOS).save(OUT + stem + '-thumb.webp', 'WEBP', quality=76, method=6)
W, H = 1600, 1000
# 1 Dawn ridge, 2 Fog valley, 3 Night range, 4 Canyon
landscape(W,H,(150,178,204),(244,212,180),(1080,560,46),[((168,170,184),0.60,0.10),((120,128,146),0.68,0.12),((78,88,106),0.78,0.10),((44,52,66),0.90,0.07)],41,'bg-dawn.jpg',(0,0,0))
landscape(W,H,(196,204,200),(226,228,220),None,[((176,186,180),0.52,0.08),((140,156,148),0.62,0.10),((96,116,106),0.74,0.10),((58,76,66),0.86,0.08)],52,'bg-fog.jpg',(0,0,0))
landscape(W,H,(12,16,26),(40,48,70),(400,300,10),[((44,52,72),0.58,0.10),((32,38,56),0.68,0.12),((22,27,40),0.80,0.10),((12,15,24),0.92,0.06)],63,'bg-night.jpg',(0,0,0))
landscape(W,H,(232,196,160),(246,226,196),(500,520,40),[((214,150,110),0.56,0.12),((180,110,80),0.66,0.14),((132,76,58),0.78,0.12),((84,46,40),0.90,0.08)],74,'bg-canyon.jpg',(0,0,0))
# 5 Dunes: smooth sine layers with light and shadow
def dunes(name, sky_top, sky_bot, cols, seed):
    random.seed(seed); img = Image.new('RGB',(W,H)); d = ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)], fill=lerp(sky_top, sky_bot, y/H))
    for i,(c,base,amp) in enumerate(cols):
        ph = random.uniform(0,6); f1 = random.uniform(1.2,2.2); f2 = random.uniform(3,5)
        pts = [(x, base*H - amp*H*(math.sin(x/W*math.pi*f1+ph)*0.7 + math.sin(x/W*math.pi*f2+ph*2)*0.3)) for x in range(0, W+8, 8)]
        lay = Image.new('L',(W,H),0); ld = ImageDraw.Draw(lay); ld.polygon(pts+[(W,H),(0,H)], fill=255)
        shade = Image.new('RGB',(W,H)); sd = ImageDraw.Draw(shade)
        for y in range(H):
            t = max(0, min(1, (y - base*H + amp*H) / (H*0.35)))
            sd.line([(0,y),(W,y)], fill=lerp(c, lerp(c,(0,0,0),0.35), t))
        img.paste(shade,(0,0),lay.filter(ImageFilter.GaussianBlur(0.8)))
    px = img.load()
    for _ in range(W*H//3):
        x = random.randrange(W); y = random.randrange(H); v = random.randint(-7,7); r,g,b = px[x,y]; px[x,y] = (max(0,min(255,r+v)),max(0,min(255,g+v)),max(0,min(255,b+v)))
    save(img, name)
# 6 Coast: sea horizon with sun path
def coast(name):
    random.seed(9); img = Image.new('RGB',(W,H)); d = ImageDraw.Draw(img); hz = int(H*0.58)
    for y in range(hz): d.line([(0,y),(W,y)], fill=lerp((72,104,140),(238,196,160),y/hz))
    for y in range(hz,H): d.line([(0,y),(W,y)], fill=lerp((96,116,138),(30,46,64),(y-hz)/(H-hz)))
    g = Image.new('L',(W,H),0); gd = ImageDraw.Draw(g); gd.ellipse([W*0.62-60,hz-90,W*0.62+60,hz+30],fill=220); g = g.filter(ImageFilter.GaussianBlur(40))
    img.paste(Image.new('RGB',(W,H),(255,230,196)),(0,0),g)
    d = ImageDraw.Draw(img)
    for i in range(260):
        y = random.uniform(hz+4, H); spread = 30 + (y-hz)*0.9; x = W*0.62 + random.gauss(0, spread*0.5); w = random.uniform(10, 60)*(0.4+(y-hz)/(H-hz))
        a = max(0, 1-(y-hz)/(H-hz))
        d.line([(x-w/2,y),(x+w/2,y)], fill=lerp((96,116,138),(255,226,190),0.55*a+0.1), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    px = img.load()
    for _ in range(W*H//3):
        x = random.randrange(W); y = random.randrange(H); v = random.randint(-7,7); r,g2,b = px[x,y]; px[x,y] = (max(0,min(255,r+v)),max(0,min(255,g2+v)),max(0,min(255,b+v)))
    save(img, name)
def grain(img, seed, amt=7):
    random.seed(seed); px = img.load()
    for _ in range(W*H//3):
        x = random.randrange(W); y = random.randrange(H); v = random.randint(-amt, amt); r,g,b = px[x,y]; px[x,y] = (max(0,min(255,r+v)),max(0,min(255,g+v)),max(0,min(255,b+v)))
    return img
def sky(top, bot, h=H):
    img = Image.new('RGB',(W,H)); d = ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)], fill=lerp(top, bot, min(1, y/h)))
    return img
def paste_layer(img, poly, col, blur=0):
    lay = Image.new('L',(W,H),0); ImageDraw.Draw(lay).polygon(poly, fill=255)
    if blur: lay = lay.filter(ImageFilter.GaussianBlur(blur))
    img.paste(Image.new('RGB',(W,H),col),(0,0),lay)
# 7 Forest: layered tree lines in fog
def forest():
    random.seed(11); img = sky((208,216,212),(232,234,226))
    layers = [((176,188,182),0.50,3.0),((136,154,146),0.60,2.0),((96,118,108),0.72,1.0),((52,70,62),0.86,0)]
    for i,(col,base,blur) in enumerate(layers):
        lay = Image.new('L',(W,H),0); d = ImageDraw.Draw(lay)
        p = ridge(W, base*H, 0.04*H, 100+i); d.polygon(p+[(W,H),(0,H)], fill=255)
        x = -10
        while x < W+10:
            h = random.uniform(40, 110)*(1+i*0.5); w = h*random.uniform(0.28,0.4)
            yb = base*H + random.uniform(-6, 12)
            d.polygon([(x, yb), (x+w/2, yb-h), (x+w, yb)], fill=255)
            x += w*random.uniform(0.45, 0.8)
        if blur: lay = lay.filter(ImageFilter.GaussianBlur(blur))
        img.paste(Image.new('RGB',(W,H),col),(0,0),lay)
    save(grain(img, 11), 'bg-forest.jpg')
# 8 Snow peaks: sharp ridges, each face lit from above
def peaks():
    random.seed(12); img = sky((112,150,190),(214,226,236))
    for i,(col,cap,base,amp) in enumerate([((150,168,190),(232,238,246),0.55,0.20),((96,116,142),(214,224,238),0.68,0.16),((52,70,92),(150,170,196),0.84,0.10)]):
        p = ridge(W, base*H, amp*H, 200+i, rough=0.62)
        lay = Image.new('L',(W,H),0); ImageDraw.Draw(lay).polygon(p+[(W,H),(0,H)], fill=255)
        fill = Image.new('RGB',(W,H)); fd = ImageDraw.Draw(fill)
        top = (base-amp*1.1)*H
        for y in range(H):
            t = max(0, min(1, (y-top)/(amp*H*1.2))); fd.line([(0,y),(W,y)], fill=lerp(cap, col, t**0.6))
        img.paste(fill,(0,0),lay.filter(ImageFilter.GaussianBlur(0.6 + (2-i)*0.8)))
    save(grain(img, 12), 'bg-peaks.jpg')
# 9 Rolling hills
def hills():
    random.seed(13); img = sky((170,200,220),(236,232,210))
    for i,(c,base,amp) in enumerate([((168,190,150),0.55,0.05),((136,170,112),0.65,0.06),((104,146,86),0.76,0.06),((72,112,60),0.88,0.05)]):
        ph = random.uniform(0,6); f1 = random.uniform(1.0,1.8)
        pts = [(x, base*H - amp*H*math.sin(x/W*math.pi*f1+ph)) for x in range(0, W+8, 8)]
        paste_layer(img, pts+[(W,H),(0,H)], c, 0.8)
    save(grain(img, 13), 'bg-hills.jpg')
# 10 Still lake: ridges mirrored in water
def lake():
    random.seed(14); img = sky((40,70,96),(226,180,140), int(H*0.55))
    hz = int(H*0.6)
    for i,(c,base,amp) in enumerate([((96,90,110),0.50,0.10),((64,62,82),0.56,0.07)]):
        p = ridge(W, base*H, amp*H, 300+i); paste_layer(img, [(x,min(y,hz)) for x,y in p]+[(W,hz),(0,hz)], c, 1.2-i*0.6)
    top = img.crop((0,0,W,hz)); ref = ImageOps.flip(top).filter(ImageFilter.GaussianBlur(3))
    ref = Image.blend(ref, Image.new('RGB', ref.size, (20,34,48)), 0.35)
    img.paste(ref.crop((0,0,W,H-hz)), (0,hz))
    d = ImageDraw.Draw(img)
    for _ in range(160):
        y = random.uniform(hz+3, H); x = random.uniform(0, W); w = random.uniform(20,120)
        d.line([(x,y),(x+w,y)], fill=(150,150,160), width=1)
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    save(grain(img, 14), 'bg-lake.jpg')
# 11 City at dusk: skyline with lit windows
def city():
    random.seed(15); img = sky((26,32,58),(196,122,96), int(H*0.75)); d = ImageDraw.Draw(img)
    for layer,(col,hmin,hmax,base,lit) in enumerate([((58,56,80),120,300,0.80,0.0),((30,30,46),180,460,0.92,0.18)]):
        x = -20
        while x < W:
            w = random.uniform(50,130); h = random.uniform(hmin,hmax); yb = base*H
            d.rectangle([x, yb-h, x+w, H], fill=col)
            if random.random() < 0.3: d.rectangle([x+w*0.4, yb-h-30, x+w*0.45, yb-h], fill=col)
            if lit:
                for wy in range(int(yb-h+12), H, 16):
                    for wx in range(int(x+8), int(x+w-8), 12):
                        if random.random() < lit: d.rectangle([wx, wy, wx+4, wy+6], fill=(240,200,130))
            x += w + random.uniform(-10, 8)
    save(grain(img, 15, 5), 'bg-city.jpg')
# 12 Aurora: thin vertical curtains along a curve
def aurora():
    random.seed(16); img = sky((6,12,24),(20,34,52))
    band = Image.new('L',(W,H),0); bd = ImageDraw.Draw(band)
    for i in range(0, W, 3):
        y = H*0.34 + 70*math.sin(i/W*math.pi*2.0) + 22*math.sin(i/W*math.pi*9)
        h = random.uniform(80, 220)*(0.6+0.4*math.sin(i/W*math.pi*3)**2)
        for k in range(int(h)):
            a = int(150*(1-k/h)**1.5)
            bd.point((i, y-k), fill=a); bd.point((i+1, y-k), fill=a)
    band = band.filter(ImageFilter.GaussianBlur(4))
    glow = band.filter(ImageFilter.GaussianBlur(28))
    img.paste(Image.new('RGB',(W,H),(60,170,140)),(0,0),glow)
    img.paste(Image.new('RGB',(W,H),(120,230,180)),(0,0),band)
    d = ImageDraw.Draw(img)
    for _ in range(300):
        x = random.uniform(0,W); y = random.uniform(0,H*0.65); v = random.randint(140,230); d.point((x,y), fill=(v,v,v))
    p = ridge(W, 0.80*H, 0.08*H, 401); paste_layer(img, p+[(W,H),(0,H)], (8,12,18), 0.5)
    save(grain(img, 16, 5), 'bg-aurora.jpg')
# 13 Clouds: soft overcast with breaks of light
def clouds():
    random.seed(17); img = sky((120,150,184),(224,226,230))
    for i in range(70):
        c = Image.new('L',(W,H),0); cd = ImageDraw.Draw(c)
        x = random.uniform(-100,W); y = random.uniform(0,H*0.8); r = random.uniform(60,200)
        cd.ellipse([x-r*2, y-r*0.6, x+r*2, y+r*0.6], fill=random.randint(60,140))
        c = c.filter(ImageFilter.GaussianBlur(r*0.5))
        img.paste(Image.new('RGB',(W,H),lerp((236,238,242),(150,160,176),y/H)),(0,0),c)
    save(grain(img, 17, 5), 'bg-clouds.jpg')
# 14 Ocean swell: wave bands
def swell():
    random.seed(18); img = sky((180,206,220),(220,230,232), int(H*0.35))
    for i in range(14):
        base = 0.35 + i*0.05; c = lerp((120,160,176),(18,52,72), i/13)
        ph = random.uniform(0,6)
        pts = [(x, base*H - 10*(1+i*0.3)*math.sin(x/W*math.pi*(3+i*0.4)+ph)) for x in range(0, W+8, 8)]
        paste_layer(img, pts+[(W,H),(0,H)], c, 0.6)
    save(grain(img, 18, 5), 'bg-swell.jpg')

if __name__ == '__main__':
    landscape(W,H,(150,178,204),(244,212,180),(1080,560,46),[((168,170,184),0.60,0.10),((120,128,146),0.68,0.12),((78,88,106),0.78,0.10),((44,52,66),0.90,0.07)],41,'bg-dawn.jpg',(0,0,0))
    landscape(W,H,(196,204,200),(226,228,220),None,[((176,186,180),0.52,0.08),((140,156,148),0.62,0.10),((96,116,106),0.74,0.10),((58,76,66),0.86,0.08)],52,'bg-fog.jpg',(0,0,0))
    landscape(W,H,(12,16,26),(40,48,70),(400,300,10),[((44,52,72),0.58,0.10),((32,38,56),0.68,0.12),((22,27,40),0.80,0.10),((12,15,24),0.92,0.06)],63,'bg-night.jpg',(0,0,0))
    landscape(W,H,(232,196,160),(246,226,196),(500,520,40),[((214,150,110),0.56,0.12),((180,110,80),0.66,0.14),((132,76,58),0.78,0.12),((84,46,40),0.90,0.08)],74,'bg-canyon.jpg',(0,0,0))
    dunes('bg-dunes.jpg',(196,214,226),(240,226,204),[((226,186,140),0.58,0.05),((210,160,114),0.68,0.06),((186,132,92),0.80,0.06),((150,100,70),0.92,0.05)],5)
    coast('bg-coast.jpg')
    for scene in (forest, peaks, hills, lake, city, aurora, clouds, swell):
        scene()
    print('scenes written to', OUT)
