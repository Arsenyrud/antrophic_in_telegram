#!/usr/bin/env python3
from PIL import Image, ImageDraw

S = 512
img = Image.new('RGB', (S, S), '#1F1E1D')
d = ImageDraw.Draw(img)

# фоновый градиент: тёмный уголь -> тёплый низ
for y in range(S):
    t = y / S
    r = int(0x1F + t * 0x30); g = int(0x1E + t * 0x14); b = int(0x1D + t * 0x10)
    d.line([(0, y), (S, y)], fill=(r, g, b))

# скруглённая «карточка терминала»
d.rounded_rectangle([56, 96, 456, 416], radius=48, fill='#2A2826', outline='#D97757', width=6)
# три точки заголовка окна
for i, c in enumerate(['#D97757', '#E8A87C', '#6B6560']):
    d.ellipse([92 + i * 44, 128, 92 + i * 44 + 24, 152], fill=c)
# prompt: >
d.line([(120, 230), (180, 280)], fill='#D97757', width=22)
d.line([(180, 280), (120, 330)], fill='#D97757', width=22)
# курсор-блок
d.rounded_rectangle([220, 300, 330, 336], radius=8, fill='#E8A87C')
# «искра» — четырёхлучевая звезда сверху справа
cx, cy, R, r = 380, 200, 52, 14
star = [(cx, cy - R), (cx + r, cy - r), (cx + R, cy), (cx + r, cy + r),
        (cx, cy + R), (cx - r, cy + r), (cx - R, cy), (cx - r, cy - r)]
d.polygon(star, fill='#D97757')

img.save('scripts/avatar.png')
print('scripts/avatar.png written')
