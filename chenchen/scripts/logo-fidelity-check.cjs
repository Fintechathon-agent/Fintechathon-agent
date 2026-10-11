"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createPreviewServer } = require("./xinlan-preview.cjs");
const { server: core } = require("../server");
const expected = "feb9fa2a3ea39e41230ebc67f604141fa7f07c353d2f13b68f91ca43418fbe7b";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
(async () => {
  const file = path.resolve(__dirname, "../versions/xinlan/team-logo.png");
  const original = fs.readFileSync(file);
  assert.equal(hash(original), expected);
  assert.equal(original.readUInt32BE(16), 1254);
  assert.equal(original.readUInt32BE(20), 1254);
  if (process.env.LOGO_SOURCE) assert.equal(hash(fs.readFileSync(process.env.LOGO_SOURCE)), expected);
  const preview = createPreviewServer();
  let browser;
  const evidence = [];
  try {
    await Promise.all([preview, core].map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
    const shell = "http://127.0.0.1:" + preview.address().port;
    const investment = "http://127.0.0.1:" + core.address().port;
    browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}) });
    const context = await browser.newContext();
    const page = await context.newPage();
    const browserImages = new Map();
    page.on("response", response => {
      if(new URL(response.url()).pathname.endsWith("/team-logo.png"))browserImages.set(response.url(),response);
    });
    const out = process.env.LOGO_SCREENSHOTS;
    if(out)fs.mkdirSync(out,{recursive:true});
    for(const width of [1440,375]) {
      await page.setViewportSize({width,height:1000});
      for(const name of ["personal","console","investment"]) {
        await page.goto(name === "investment" ? investment+"/investment" : shell+"/xinlan/index.html");
        if(name === "console")await page.locator("#role").selectOption("analyst");
        if(name === "investment")await page.locator("#results").waitFor({state:"visible"});
        const logo = page.locator("img.team-logo");
        await logo.evaluate(image => image.decode());
        const result = await logo.evaluate(image => {
          const css=getComputedStyle(image), rect=image.getBoundingClientRect();
          const ancestors=[];
          for(let node=image;node;node=node.parentElement) {
            const style=getComputedStyle(node);
            ancestors.push({filter:style.filter,mask:style.maskImage,clip:style.clipPath,opacity:style.opacity,transform:style.transform,overflow:style.overflow,containsLogo:(()=>{const r=node.getBoundingClientRect();return rect.left>=r.left && rect.right<=r.right && rect.top>=r.top && rect.bottom<=r.bottom;})()});
          }
          const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let opaque=true;for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){opaque=false;break;}
          return {url:image.currentSrc,natural:[image.naturalWidth,image.naturalHeight],rendered:[rect.width,rect.height],fit:css.objectFit,position:css.objectPosition,radius:css.borderRadius,opaque,corner:Array.from(pixels.slice(0,4)),ancestors,title:document.title};
        });
        assert.deepEqual(result.natural,[1254,1254]); assert.equal(result.rendered[0],result.rendered[1]);
        assert.equal(result.fit,"contain");assert.equal(result.position,"50% 50%");assert.equal(result.radius,"0px");
        assert.equal(result.opaque,true);assert.deepEqual(result.corner,[0,0,0,255]);
        for(const ancestor of result.ancestors) {
          assert.equal(ancestor.filter,"none");assert.equal(ancestor.mask,"none");assert.equal(ancestor.clip,"none");assert.equal(ancestor.opacity,"1");assert.equal(ancestor.transform,"none");
          if(["hidden","clip"].includes(ancestor.overflow))assert.equal(ancestor.containsLogo,true,"Logo must fit entirely inside any clipped ancestor");
        }
        const response=await context.request.get(result.url);
        assert.equal(response.status(),200);assert.match(response.headers()["content-type"],/image\/png/);
        const servedHash=hash(await response.body());assert.equal(servedHash,expected);
        assert.ok(browserImages.has(result.url),"Browser must load the original image URL");
        assert.equal(hash(await browserImages.get(result.url).body()),expected);
        const favicon=await page.locator('link[rel="icon"]').evaluate(link=>link.href);
        assert.equal(hash(await (await context.request.get(favicon)).body()),expected);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(/昕澜金融|XINLAN FINANCE/.test(await page.locator("body").innerText()),false);
        if(out)await page.screenshot({path:path.join(out,name+"-"+width+".png"),fullPage:true});
        evidence.push({page:name,width,...result,servedHash,favicon});
      }
    }
    const report={passed:true,sha256:expected,dimensions:[1254,1254],favicon:"Original PNG; no derivative or transcoding",login:"No implemented login screen; current entry is a preview shell",evidence};
    if(out)fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify({passed:true,sha256:expected,pages:6,opaque:true,originalBytesServed:true}));
  } finally {
    if(browser)await browser.close();
    await Promise.all([preview,core].filter(server=>server.listening).map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
