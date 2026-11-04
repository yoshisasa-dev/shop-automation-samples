"""トップページの看板画像（2400×1100）。ケーキのイラスト3つを横に並べて PNG にする"""
import os, re, subprocess, urllib.parse
import make

W, H = 2400, 1100


def hero():
    body = ''
    for x, fn in [(140, make.tart), (780, make.shortcake), (1420, make.gateau)]:
        inner = fn().replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">',
                             f'<svg x="{x}" y="120" width="840" height="840" viewBox="0 0 1200 1200" overflow="visible">')
        # 1枚ずつの背景（四角と丸）は外して、1枚の看板になじませる
        inner = re.sub(r'<rect width="1200" height="1200"[^>]*/>|<circle cx="(1040|150)"[^>]*/>', '', inner)
        body += inner
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <rect width="{W}" height="{H}" fill="#f7e9de"/>
  <circle cx="2250" cy="140" r="160" fill="#ffffff" opacity="0.35"/>
  <circle cx="120" cy="1000" r="200" fill="#ffffff" opacity="0.3"/>
  {body}
</svg>'''


if __name__ == '__main__':
    os.makedirs(os.path.join(make.HERE, 'out'), exist_ok=True)
    src =os.path.join(make.HERE, 'src', 'hero.html')
    with open(src, 'w', encoding='utf-8') as f:
        f.write(f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden}}</style></head><body>' + hero() + '</body></html>')
    out = os.path.join(make.HERE, 'out', 'hero.png')
    subprocess.run([make.CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={W},{H}', '--screenshot=' + out, 'file://' + urllib.parse.quote(src)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    print(out)
