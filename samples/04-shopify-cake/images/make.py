"""ケーキ・焼き菓子のイラスト画像（1200×1200）を SVG で作り、Mac の Chrome で PNG にする"""
import os, subprocess, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def cylinder(cx, top, rx, ry, h, side, top_color, edge=None):
    edge = edge or side
    return f'''
  <rect x="{cx-rx}" y="{top}" width="{rx*2}" height="{h}" fill="{side}"/>
  <ellipse cx="{cx}" cy="{top+h}" rx="{rx}" ry="{ry}" fill="{side}"/>
  <ellipse cx="{cx}" cy="{top}" rx="{rx}" ry="{ry}" fill="{top_color}" stroke="{edge}" stroke-width="3"/>'''


def plate(cx, y, rx):
    return f'<ellipse cx="{cx}" cy="{y}" rx="{rx}" ry="{rx*0.22}" fill="#ffffff" stroke="#e8dfd6" stroke-width="6"/>' \
           f'<ellipse cx="{cx}" cy="{y+18}" rx="{rx*0.9}" ry="{rx*0.16}" fill="#000" opacity="0.06"/>'


def strawberry(x, y, s=1.0):
    return f'''<g transform="translate({x},{y}) scale({s})">
    <path d="M0,-38 C34,-38 44,-10 30,18 C20,38 8,48 0,52 C-8,48 -20,38 -30,18 C-44,-10 -34,-38 0,-38Z" fill="#e8434f"/>
    <g fill="#ffd9a8">{''.join(f'<circle cx="{dx}" cy="{dy}" r="2.4"/>' for dx, dy in [(-14,-14),(0,-20),(14,-12),(-18,4),(-4,0),(12,6),(-8,20),(6,24),(18,-2)])}</g>
    <path d="M-22,-36 L-6,-30 L0,-46 L6,-30 L22,-36 L12,-24 L-12,-24Z" fill="#4c9a52"/></g>'''


def cream(x, y, s=1.0, color='#fffaf3'):
    return f'''<g transform="translate({x},{y}) scale({s})">
    <path d="M-26,10 C-30,-8 -14,-12 -12,-22 C-6,-38 6,-38 12,-22 C14,-12 30,-8 26,10 Z" fill="{color}" stroke="#efe3d4" stroke-width="3"/>
    <path d="M-14,0 C-6,-10 6,-10 14,0" fill="none" stroke="#efe3d4" stroke-width="3"/></g>'''


def svg(bg, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
  <rect width="1200" height="1200" fill="{bg}"/>
  <circle cx="1040" cy="170" r="90" fill="#ffffff" opacity="0.35"/>
  <circle cx="150" cy="1030" r="120" fill="#ffffff" opacity="0.3"/>
  {body}
</svg>'''


def shortcake():
    b = plate(600, 840, 420)
    b += cylinder(600, 520, 330, 95, 300, '#fff7ee', '#fffdf9', '#f1e4d3')
    b += '<rect x="270" y="640" width="660" height="34" fill="#f6b8bf"/><rect x="270" y="700" width="660" height="10" fill="#f9d7c4"/>'
    for i, x in enumerate(range(330, 880, 92)):
        b += cream(x, 520 + (40 if i % 2 else 70) - 40, 1.0)
    for x, y in [(420, 470), (520, 440), (640, 445), (760, 475), (590, 515), (470, 530), (720, 530)]:
        b += strawberry(x, y, 1.0)
    return svg('#fde4e6', b)


def gateau():
    b = plate(600, 840, 410)
    b += cylinder(600, 540, 320, 92, 280, '#5a3426', '#6e4130', '#4a2a1e')
    b += '<g fill="#ffffff" opacity="0.85">' + ''.join(
        f'<circle cx="{600 + (i * 53) % 560 - 280}" cy="{540 + ((i * 37) % 150) - 75}" r="{3 + i % 4}"/>' for i in range(90)) + '</g>'
    b += '<ellipse cx="600" cy="540" rx="240" ry="60" fill="#ffffff" opacity="0.25"/>'
    b += '<path d="M590,470 C560,430 600,400 640,420 C620,450 610,465 590,470Z" fill="#6fbf73"/>' \
         '<path d="M600,470 C640,445 680,470 670,500 C640,495 620,488 600,470Z" fill="#58a85c"/>'
    b += strawberry(560, 500, 0.8)
    return svg('#f3e6dc', b)


def tart():
    b = plate(600, 820, 430)
    b += cylinder(600, 640, 340, 100, 110, '#d99a4e', '#f2c47c', '#c88a40')
    b += '<ellipse cx="600" cy="640" rx="305" ry="86" fill="#fff3d6"/>'
    fruits = ''
    for i, (x, y) in enumerate([(430, 640), (520, 600), (620, 590), (720, 610), (780, 650), (690, 670), (580, 680), (470, 680), (600, 635)]):
        kind = i % 4
        if kind == 0:
            fruits += f'<circle cx="{x}" cy="{y}" r="42" fill="#7bbf3b"/><circle cx="{x}" cy="{y}" r="30" fill="#a8d86a"/><circle cx="{x}" cy="{y}" r="10" fill="#f3f7d9"/>'
        elif kind == 1:
            fruits += f'<circle cx="{x}" cy="{y}" r="40" fill="#f59a2a"/><circle cx="{x}" cy="{y}" r="30" fill="#ffc35c"/>'
        elif kind == 2:
            fruits += strawberry(x, y - 10, 0.85)
        else:
            fruits += ''.join(f'<circle cx="{x + dx}" cy="{y + dy}" r="16" fill="#4b4fa8"/>' for dx, dy in [(-18, 0), (16, -6), (0, 16)])
    b += fruits
    b += ''.join(f'<path d="M{260 + i*40},700 q20,30 40,0" fill="#e2a95c"/>' for i in range(17))
    return svg('#fff1d9', b)


def cheese():
    b = plate(600, 840, 410)
    b += cylinder(600, 560, 320, 92, 250, '#f7dd92', '#b8743a', '#9f6230')
    b += '<ellipse cx="600" cy="560" rx="300" ry="82" fill="#c98547"/>'
    b += '<rect x="280" y="780" width="640" height="30" fill="#e8c06a"/>'
    b += '<path d="M560,500 C540,470 570,450 600,465 C590,485 580,495 560,500Z" fill="#6fbf73"/>'
    b += '<circle cx="610" cy="505" r="22" fill="#4b4fa8"/><circle cx="640" cy="515" r="18" fill="#5a5fbf"/>'
    return svg('#fdf3d0', b)


def gift():
    b = '<ellipse cx="600" cy="900" rx="380" ry="60" fill="#000" opacity="0.07"/>'
    b += '<rect x="290" y="470" width="620" height="420" rx="18" fill="#ffffff" stroke="#e7d9ca" stroke-width="6"/>'
    b += '<rect x="290" y="430" width="620" height="90" rx="14" fill="#fff8f1" stroke="#e7d9ca" stroke-width="6"/>'
    b += '<rect x="570" y="430" width="60" height="460" fill="#e9a8b5"/><rect x="290" y="650" width="620" height="50" fill="#e9a8b5"/>'
    b += '<path d="M600,430 C520,330 440,380 520,430Z M600,430 C680,330 760,380 680,430Z" fill="#e48fa1"/><circle cx="600" cy="430" r="26" fill="#d97a8f"/>'
    for x, y in [(380, 560), (820, 800), (390, 800), (820, 560)]:
        b += f'<circle cx="{x}" cy="{y}" r="46" fill="#e7b46f"/><circle cx="{x}" cy="{y}" r="34" fill="#f1c886"/>' \
             + ''.join(f'<circle cx="{x + dx}" cy="{y + dy}" r="6" fill="#7a4a2a"/>' for dx, dy in [(-12, -8), (10, 6), (-4, 14)])
    return svg('#efe6f7', b)


def financier():
    b = '<ellipse cx="600" cy="880" rx="420" ry="60" fill="#000" opacity="0.07"/>'
    b += '<rect x="230" y="760" width="740" height="40" rx="20" fill="#ffffff" stroke="#e8dfd6" stroke-width="6"/>'
    for i, (x, y) in enumerate([(300, 640), (520, 640), (740, 640), (410, 520), (630, 520)]):
        b += f'<path d="M{x},{y} l180,0 l-14,110 l-152,0 Z" fill="#d48a3c"/>' \
             f'<path d="M{x+10},{y} l160,0 l-6,28 l-148,0 Z" fill="#e9a956"/>' \
             f'<path d="M{x+30},{y+50} q60,-14 120,0" stroke="#b9732c" stroke-width="5" fill="none"/>'
    return svg('#fbecd6', b)


def cookie_tin():
    b = '<ellipse cx="600" cy="880" rx="400" ry="70" fill="#000" opacity="0.07"/>'
    b += cylinder(600, 560, 360, 120, 230, '#8fc1d9', '#bfe0ee', '#7aaec7')
    b += '<ellipse cx="600" cy="560" rx="330" ry="104" fill="#f6efe4"/>'
    colors = [('#e7b46f', '#f1c886'), ('#7a4a2a', '#94603a'), ('#f3d9a6', '#fbe9c6'), ('#e48fa1', '#f2b3c0')]
    pos = [(450, 545), (560, 515), (680, 525), (760, 570), (520, 600), (640, 610), (400, 595)]
    for i, (x, y) in enumerate(pos):
        c1, c2 = colors[i % 4]
        b += f'<ellipse cx="{x}" cy="{y}" rx="60" ry="26" fill="{c1}"/><ellipse cx="{x}" cy="{y-4}" rx="48" ry="19" fill="{c2}"/>'
    b += '<rect x="240" y="690" width="720" height="40" fill="#ffffff" opacity="0.5"/>'
    return svg('#e3f0f5', b)


IMAGES = {
    'shortcake': shortcake, 'gateau-chocolat': gateau, 'fruit-tart': tart, 'cheesecake': cheese,
    'gift-box': gift, 'financier': financier, 'cookie-tin': cookie_tin,
}

if __name__ == '__main__':
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    for name, fn in IMAGES.items():
        src = os.path.join(HERE, 'src', name + '.html')
        with open(src, 'w', encoding='utf-8') as f:
            f.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1200px;height:1200px;overflow:hidden}</style></head><body>' + fn() + '</body></html>')
        out = os.path.join(HERE, 'out', name + '.png')
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                        '--window-size=1200,1200', '--screenshot=' + out, 'file://' + urllib.parse.quote(src)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        print(out)
