// Versión de impresión térmica: escala de grises sobre blanco, con oscurecimiento
// gamma para que amarillo/naranja no desaparezcan en impresoras monocromáticas.
import {PNG} from 'pngjs';
import {readFileSync,writeFileSync} from 'node:fs';
const [src,dst]=process.argv.slice(2);
const png=PNG.sync.read(readFileSync(src));
const out=new PNG({width:png.width,height:png.height,colorType:0,inputHasAlpha:false});
for(let i=0;i<png.width*png.height;i++){
 const r=png.data[i*4],g=png.data[i*4+1],b=png.data[i*4+2],a=png.data[i*4+3]/255;
 const lum=0.299*r+0.587*g+0.114*b;
 const flat=lum*a+255*(1-a);
 let v=255*Math.pow(flat/255,1.9);
 if(flat>245)v=255;
 out.data[i*4]=out.data[i*4+1]=out.data[i*4+2]=Math.round(v);out.data[i*4+3]=255;
}
writeFileSync(dst,PNG.sync.write(out,{colorType:0}));
