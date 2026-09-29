"""Render the app's code-defined, three-page identity to Windows icon sizes."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
folder=root/'build-resources';folder.mkdir(exist_ok=True)
image=Image.new('RGBA',(256,256),(0,0,0,0));draw=ImageDraw.Draw(image)
draw.rounded_rectangle((6,6,250,250),radius=54,fill='#173e34')
draw.rounded_rectangle((50,39,159,178),radius=12,fill='#e5eedc')
draw.rounded_rectangle((75,59,184,198),radius=12,fill='#b0d5b9')
draw.rounded_rectangle((100,79,210,218),radius=12,fill='#448e72')
for y in (113,138,163):draw.rounded_rectangle((124,y,185,y+6),radius=3,fill='#f1f5e7')
image.save(folder/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.save(root/'public/icon.png')
