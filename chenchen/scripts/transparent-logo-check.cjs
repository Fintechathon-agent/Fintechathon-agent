const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {server} = require('../server');
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
    const page=await browser.newPage(); const report=[];
    fs.mkdirSync('review/transparent-logo',{recursive:true});
    for(const width of [1440,375]) for(const [name,route] of [['landing','/'],['investment','/investment'],['merchant','/merchant']]) {
      await page.setViewportSize({width,height:1000}); await page.goto(base+route);
      const logo=page.locator('img.team-logo-cutout'); await logo.evaluate(img=>img.decode());
      const result=await logo.evaluate(img=>{
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let transparent=0,opaque=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent++;if(pixels[i]>=240)opaque++;}
        const css=getComputedStyle(img),rect=img.getBoundingClientRect();
        return {url:img.currentSrc,transparent,opaque,corner:pixels[3],width:rect.width,height:rect.height,fit:css.objectFit,filter:css.filter,clip:css.clipPath};
      });
      assert.equal(result.corner,0);assert.ok(result.transparent>100000);assert.ok(result.opaque>100000);
      assert.equal(result.width,result.height);assert.equal(result.fit,'contain');assert.equal(result.filter,'none');assert.equal(result.clip,'none');
      const response=await page.request.get(result.url);assert.match(response.headers()['content-type'],/image\/png/);
      assert.equal(createHash('sha256').update(await response.body()).digest('hex'),'fba7a4e1b36b9f8f40057cf655f446009c5943bd6bbfbd1d0f3d6d0b14b246d6');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'review/transparent-logo/'+name+'-'+width+'.png'});
      report.push({name,width,...result});
    }
    fs.writeFileSync('review/transparent-logo/report.json',JSON.stringify(report,null,2));
    console.log('PASS: six desktop/mobile transparent logo cases');
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
