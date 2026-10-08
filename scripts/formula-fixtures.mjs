// Original regression formulas: safe to use in public screenshots.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import katex from 'katex';
const folder=path.resolve('tmp/formula-plus');await fs.mkdir(folder,{recursive:true});
const samples={
  matrix:String.raw`A=\begin{pmatrix} a_{11}&\frac{1}{2}&x^2\\0&a_{22}&\frac{x_i}{y_j}\\-1&0&a_{33}\end{pmatrix},\qquad B=\begin{bmatrix}1&0\\0&1\end{bmatrix}`,
  multiline:String.raw`\begin{aligned}g(y_j)&=\sum_{i=1}^{n}\frac{K(f(x_i),\tilde f(y_j))}{\sum_{\ell=1}^{n}K(f(x_\ell),\tilde f(y_j))\Delta_\ell}\,v(f(x_i))\Delta_i\\&\approx\int_{D_f}\frac{K(f(x),\tilde f(y_j))}{\int_{D_f}K(f(z),\tilde f(y_j))\,dz}\,v(f(x))\,dx.\end{aligned}`,
};
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1200,height:500},deviceScaleFactor:2});
  for(const [name,latex] of Object.entries(samples)){
    const html=path.join(folder,name+'.html');
    await fs.writeFile(html,`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../../node_modules/katex/dist/katex.min.css"><style>body{margin:0;background:white}.formula{display:inline-block;padding:24px;font-size:24px}.katex-display{margin:0}@page{size:900px 400px;margin:0}</style><div class="formula">${katex.renderToString(latex,{displayMode:true,throwOnError:true})}</div>`);
    await page.goto('file:///'+html.replaceAll('\\','/'));await page.evaluate(()=>document.fonts.ready);
    await page.locator('.formula').screenshot({path:path.join(folder,name+'.png')});
    await page.pdf({path:path.join(folder,name+'.pdf'),preferCSSPageSize:true});
  }
  await fs.writeFile(path.join(folder,'expected.json'),JSON.stringify(samples,null,2));
}finally{await browser.close();}
