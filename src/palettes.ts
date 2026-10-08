export const palettes=[
  {id:'monet',name:'莫奈 · 睡莲',detail:'烟紫 · 水蓝 · 藕粉',colors:['#526781','#879d9a','#b5afcf','#d4b4bd','#e8dec8']},
  {id:'vermeer',name:'维米尔 · 珍珠',detail:'群青 · 赭金 · 象牙白',colors:['#28486b','#77899a','#b49a64','#d9caa6','#f0e9dc']},
  {id:'morandi',name:'莫兰迪 · 静物',detail:'陶土 · 雾灰 · 鼠尾草',colors:['#80655e','#a58c7c','#aeb1a2','#c9b7ad','#ebe3d8']},
];
export function paletteId(){const saved=localStorage.getItem('palette');return palettes.some(p=>p.id===saved)?saved!:'monet';}
