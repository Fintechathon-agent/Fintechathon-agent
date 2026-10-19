'use strict';
// UI text must not contain symbols that iOS / Android may draw as colour emoji
// (for example U+2197 "↗" becomes a blue emoji box on iOS). Use an inline SVG icon instead.
const fs=require('node:fs'),path=require('node:path');
const RANGES='00A9 00AE 203C 2049 2122 2139 2194-2199 21A9-21AA 231A-231B 2328 23CF 23E9-23F3 23F8-23FA 24C2 25AA-25AB 25B6 25C0 25FB-25FE 2600-2604 260E 2611 2614-2615 2618 261D 2620 2622-2623 2626 262A 262E-262F 2638-263A 2640 2642 2648-2653 265F-2660 2663 2665-2666 2668 267B 267E-267F 2692-2697 2699 269B-269C 26A0-26A1 26A7 26AA-26AB 26B0-26B1 26BD-26BE 26C4-26C5 26C8 26CE-26CF 26D1 26D3-26D4 26E9-26EA 26F0-26F5 26F7-26FA 26FD 2702 2705 2708-270D 270F 2712 2714 2716 271D 2721 2728 2733-2734 2744 2747 274C 274E 2753-2755 2757 2763-2764 2795-2797 27A1 27B0 27BF 2934-2935 2B05-2B07 2B1B-2B1C 2B50 2B55 3030 303D 3297 3299'
  .split(' ').map(t=>{const [a,b]=t.split('-').map(h=>parseInt(h,16));return [a,b??a];});
const risky=cp=>cp>=0x1F000||RANGES.some(([a,b])=>cp>=a&&cp<=b);
const escaped=/\\(?:u\{?)?0*(2197|219[4-9]|21a9|21aa)\b|&#x?0*(8599|2197);|&nearr;/i;
function glyphCheck(dir){
  const problems=[];
  for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name);
    if(fs.statSync(file).isDirectory()){problems.push(...glyphCheck(file));continue;}
    if(!/\.(html|css|js|mjs)$/.test(name))continue;
    fs.readFileSync(file,'utf8').split('\n').forEach((line,i)=>{
      for(const ch of line){const cp=ch.codePointAt(0);if(risky(cp))problems.push(`${file}:${i+1} U+${cp.toString(16).toUpperCase()} ${ch}`);}
      if(escaped.test(line))problems.push(`${file}:${i+1} escaped arrow ${line.match(escaped)[0]}`);
    });
  }
  return problems;
}
module.exports={glyphCheck};
if(require.main===module){
  const problems=glyphCheck(path.resolve(__dirname,'../versions'));
  if(problems.length){console.error('Emoji-prone symbols found (use an inline SVG icon instead):\n'+problems.join('\n'));process.exitCode=1;}
  else console.log('Glyph check passed: no emoji-prone symbols in versions/.');
}
