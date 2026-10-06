// Decorative construction only. Importing this module never mounts a scene.
export function createArchiveScene({density = 'full'} = {}) {
  const scene = document.createElement('div');
  scene.className = 'archive-scene';
  scene.dataset.density = density === 'quiet' ? 'quiet' : 'full';
  scene.setAttribute('aria-hidden', 'true');
  scene.innerHTML = `
    <div class="archive-grid"></div>
    <div class="archive-paper archive-paper-primary">
      <span class="archive-coordinate">RECORD 0026 / XL</span>
      <svg viewBox="0 0 420 400" fill="none" focusable="false">
        <path d="M20 90H400M20 160H400M20 230H400M20 300H400M60 30V370M140 30V370M220 30V370M300 30V370M380 30V370"/>
        <path d="M25 310L375 80M25 280L375 210M120 30L320 365"/>
        <circle cx="220" cy="210" r="95"/><circle cx="220" cy="210" r="104"/>
      </svg>
      <span class="archive-page-number">062 / XL / 26</span>
    </div>
    <div class="archive-paper archive-paper-secondary"><span>ENTRY / 062</span><i></i><i></i><i></i></div>
    <div class="archive-ruler"></div>
    <div class="archive-stamp">LAB<span>RECORD / 26</span></div>
    <span class="archive-margin-note">26 — 062 / FINANCE LAB</span>`;
  return scene;
}

// A decorative two-pan balance. Values are local animation state, never finance data.
export function initLiquidBalance(grid) {
  if (!grid) return;
  const options = {pour:.08, maxTilt:7, damping:.45, settleDelay:6, maxLevel:1, baseLevel:.34, introPour:2, introGap:.65, slowMo:.4};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width:700px)');
  const colors = getComputedStyle(document.querySelector('.landing-product'));
  const orange = colors.getPropertyValue('--brand-orange').trim();
  const light = colors.getPropertyValue('--brand-highlight').trim();
  const dark = colors.getPropertyValue('--brand-shadow').trim();
  const pans = [...grid.querySelectorAll('.feature-card')].map((card,index) => {
    const button=card.querySelector('.liquid-vessel'), diagram=card.querySelector('.archive-diagram');
    return {card,button,diagram,index,label:button.getAttribute('aria-label'),water:button.querySelector('canvas'),dropsCanvas:diagram.querySelector('.liquid-drops'),hint:card.querySelector('.pour-hint'),level:reduced.matches?options.baseLevel:0,drops:[],wave:new Float64Array(40),velocity:new Float64Array(40),visible:false,started:reduced.matches,done:reduced.matches,age:0,emitted:0,delay:0,w:1,h:1,dw:1,dh:1,shake:0,lastInput:-Infinity,hintUntil:0};
  });
  let frame=0, timer=0, previous=0, theta=0, angularVelocity=0, recovery=1, clock=0;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const pending=p=>p.drops.reduce((n,d)=>n+d.volume,0);
  const hasView=()=>!document.hidden && pans.some(p=>p.visible);
  const inIntro=()=>pans.some(p=>p.started&&!p.done);
  function fit(canvas,w,h) {
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));
    canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  }
  function resize() {
    for(const p of pans) {
      p.w=p.button.clientWidth;p.h=p.button.clientHeight;p.dw=p.diagram.clientWidth;p.dh=p.diagram.clientHeight+20;
      fit(p.water,p.w,p.h);fit(p.dropsCanvas,p.dw,p.dh);
    }
    draw();wake();
  }
  function surface(p,x) {
    const attenuation=p.level>.82?clamp((1-p.level)/.18,0,1):1;
    const column=clamp(Math.round(x/p.w*39),0,39);
    const rotation=-theta*Math.PI/180;
    return p.h*(1-p.level) + attenuation*(-(x-p.w/2)*Math.tan(rotation)+p.wave[column]);
  }
  function sync(p) {
    const full=p.level+pending(p)>=.999;
    p.card.dataset.full=String(full);p.card.dataset.ready=String(p.done && (narrow.matches || !inIntro()));
    p.card.dataset.hint=String(clock<p.hintUntil && (narrow.matches || !inIntro()));
    p.card.dataset.level=p.level.toFixed(5);p.card.dataset.pending=pending(p).toFixed(5);
    p.card.dataset.phase=!p.started?'waiting':p.done?'ready':'intro';
    p.button.setAttribute('aria-disabled',String(full));
    p.button.setAttribute('aria-label',p.label+(full?'（已满）':''));
    p.hint.textContent=full?'FULL':'TAP TO POUR';
  }
  function draw() {
    grid.style.setProperty('--beam-angle',(-theta)+'deg');grid.dataset.theta=theta.toFixed(4);
    for(const p of pans) {
      const dy=(p.index===0?1:-1)*theta*1.6;
      const shake=p.shake>0&&!reduced.matches?Math.sin(p.shake*65)*3:0;
      p.button.style.transform=`translate(${shake}px,${dy}px) rotate(${-theta}deg)`;
      const ctx=p.water.getContext('2d');ctx.clearRect(0,0,p.w,p.h);
      // Warm ticks remain visible above the liquid; submerged ticks are dark.
      ctx.strokeStyle='#b8ada075';ctx.lineWidth=1;
      for(let x=0;x<=p.w;x+=12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,p.h);ctx.stroke();}
      if(p.level>0) {
        const fill=ctx.createLinearGradient(0,0,p.w,p.h);fill.addColorStop(0,light);fill.addColorStop(.35,orange);fill.addColorStop(1,dark);
        ctx.save();ctx.beginPath();
        if(p.level>=.999)ctx.rect(0,0,p.w,p.h);
        else {ctx.moveTo(0,surface(p,0));for(let i=1;i<40;i++){const x=i*p.w/39;ctx.lineTo(x,surface(p,x));}ctx.lineTo(p.w,p.h);ctx.lineTo(0,p.h);ctx.closePath();}
        ctx.clip();ctx.fillStyle=fill;ctx.fillRect(0,0,p.w,p.h);ctx.strokeStyle='#371c12aa';
        for(let x=0;x<=p.w;x+=12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,p.h);ctx.stroke();}
        ctx.restore();
        if(p.level<.999){ctx.strokeStyle=light;ctx.lineWidth=1.5;ctx.beginPath();for(let i=0;i<40;i++){const x=i*p.w/39;i?ctx.lineTo(x,surface(p,x)):ctx.moveTo(x,surface(p,x));}ctx.stroke();}
      }
      ctx.strokeStyle='#b8ada0';ctx.lineWidth=1;
      for(let x=6;x<p.w;x+=12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,5);ctx.stroke();}
      const drop=p.dropsCanvas.getContext('2d');drop.clearRect(0,0,p.dw,p.dh);
      const scale=inIntro()?options.slowMo:options.slowMo+(1-options.slowMo)*recovery;
      drop.lineCap='round';
      for(const d of p.drops){const x=d.x*p.dw;drop.strokeStyle=orange;drop.lineWidth=d.radius*1.5;drop.beginPath();drop.moveTo(x,d.y-Math.min(14,d.v*.035)*scale);drop.lineTo(x,d.y);drop.stroke();drop.fillStyle=light;drop.beginPath();drop.arc(x,d.y,d.radius,0,Math.PI*2);drop.fill();}
      sync(p);
    }
  }
  function emit(p,volume,count,worldX) {
    for(let i=0;i<count;i++) {
      const x=clamp((worldX??(p.button.offsetLeft+p.w*(.35+Math.random()*.3)))+(Math.random()-.5)*14,p.button.offsetLeft+p.w*.12,p.button.offsetLeft+p.w*.88);
      p.drops.push({x:x/p.dw,y:0,v:30+Math.random()*35,volume:volume/count,radius:count>10?1.2:1.5+Math.random()});
    }
  }
  function start(p,delay=0) {
    if(p.started)return;p.started=true;p.delay=delay;p.age=0;recovery=0;
    wake();
  }
  function wake() {
    clearTimeout(timer);timer=0;
    if(!frame&&hasView()){previous=performance.now();frame=requestAnimationFrame(tick);grid.dataset.running='true';}
  }
  function tick(now) {
    frame=0;
    if(!hasView()){grid.dataset.running='false';return;}
    const realDt=Math.max(0,(now-previous)/1000);previous=now;clock+=realDt;
    const intro=inIntro();if(!intro)recovery=Math.min(1,recovery+realDt/.7);
    const scale=reduced.matches?1:intro?options.slowMo:options.slowMo+(1-options.slowMo)*recovery;
    const dt=Math.min(realDt,.04)*scale;
    for(const p of pans) {
      if(!p.visible)continue;
      if(p.started&&!p.done) {
        p.age+=realDt;
        const wanted=Math.floor(clamp((p.age-p.delay)/options.introPour,0,1)*40);
        while(p.emitted<wanted){emit(p,options.baseLevel/40,1);p.emitted++;}
      }
      const rot=-theta*Math.PI/180,cos=Math.cos(rot),sin=Math.sin(rot);
      const cx=p.button.offsetLeft+p.w/2,cy=p.button.offsetTop+20+p.h/2+(p.index===0?1:-1)*theta*1.6;
      p.drops=p.drops.filter(d=>{
        d.v+=800*dt;d.y+=d.v*dt;
        const dx=d.x*p.dw-cx,dy=d.y-cy;
        const x=cos*dx+sin*dy+p.w/2,y=-sin*dx+cos*dy+p.h/2;
        if(y>=surface(p,clamp(x,0,p.w)) && x>=0&&x<=p.w || d.y>p.dh){
          p.level=Math.min(options.maxLevel,p.level+d.volume);
          const column=clamp(Math.round(x/p.w*39),1,38);p.velocity[column]+=Math.min(80,d.v*.12);p.velocity[column-1]+=15;p.velocity[column+1]+=15;
          return false;
        }return true;
      });
      if(p.started&&!p.done&&p.emitted===40&&!p.drops.length){p.done=true;p.level=options.baseLevel;p.hintUntil=clock+3;p.lastInput=clock;if(!narrow.matches&&pans.every(p=>p.done))for(const pan of pans)pan.hintUntil=clock+3;}
      if(p.done&&!p.drops.length&&clock-p.lastInput>=options.settleDelay)p.level=Math.max(options.baseLevel,p.level-.05*dt);
      p.shake=Math.max(0,p.shake-realDt);
      if(!reduced.matches)for(let sub=0;sub<2;sub++) {
        const step=dt/2;
        for(let i=0;i<40;i++) {
          const lap=p.wave[Math.max(0,i-1)]+p.wave[Math.min(39,i+1)]-2*p.wave[i];
          const torque=(i/39-.5)*angularVelocity*1.5;
          p.velocity[i]+=(110*lap-38*p.wave[i]-2*options.damping*Math.sqrt(38)*p.velocity[i]+torque)*step;
        }
        for(let i=0;i<40;i++)p.wave[i]+=p.velocity[i]*step;
      }
    }
    const target=clamp((pans[0].level-pans[1].level)*options.maxTilt/.35,-options.maxTilt,options.maxTilt);
    if(reduced.matches){theta=target;angularVelocity=0;}
    else {
      angularVelocity+=(70*(target-theta)-2*options.damping*Math.sqrt(70)*angularVelocity)*dt;
      theta=clamp(theta+angularVelocity*dt,-options.maxTilt,options.maxTilt);
      if(Math.abs(theta)>=options.maxTilt)angularVelocity=0;
    }
    const moving=pans.some(p=>p.visible&&(p.drops.length||p.started&&!p.done||p.shake>0||p.level>options.baseLevel+.00001&&clock-p.lastInput>=options.settleDelay||p.wave.some((v,i)=>Math.abs(v)>.015||Math.abs(p.velocity[i])>.03)))||Math.abs(theta-target)>.002||Math.abs(angularVelocity)>.004||!intro&&recovery<1;
    if(!moving){theta=target;angularVelocity=0;for(const p of pans){p.wave.fill(0);p.velocity.fill(0);}}
    draw();
    if(moving){frame=requestAnimationFrame(tick);}
    else {
      grid.dataset.running='false';
      const waits=pans.filter(p=>p.visible).flatMap(p=>[p.level>options.baseLevel+.00001?Math.max(.01,options.settleDelay-(clock-p.lastInput)):Infinity,p.hintUntil>clock?p.hintUntil-clock:Infinity]);
      const wait=Math.min(...waits);
      if(Number.isFinite(wait))timer=setTimeout(()=>{clock+=wait;wake();},wait*1000);
    }
  }
  for(const p of pans) p.button.addEventListener('click',event=>{
    event.preventDefault();
    if(!p.done||!narrow.matches&&inIntro())return;
    p.lastInput=clock;
    const available=options.maxLevel-p.level-pending(p);
    if(available<=.001){p.shake=.25;draw();wake();return;}
    const volume=Math.min(options.pour,available);
    if(reduced.matches){p.level+=volume;theta=clamp((pans[0].level-pans[1].level)*options.maxTilt/.35,-options.maxTilt,options.maxTilt);draw();}
    else emit(p,volume,6+Math.floor(Math.random()*5),event.detail?event.clientX-p.diagram.getBoundingClientRect().left:undefined);
    wake();
  });
  const visibility=new IntersectionObserver(entries=>{
    for(const e of entries){const p=pans.find(p=>p.card===e.target);p.visible=e.isIntersecting;}
    if(hasView())wake();else {cancelAnimationFrame(frame);frame=0;clearTimeout(timer);grid.dataset.running='false';}
  },{threshold:0});
  const introduction=new IntersectionObserver(entries=>{
    for(const e of entries)if(e.isIntersecting&&e.intersectionRatio>=.35){const p=pans.find(p=>p.card===e.target);if(!reduced.matches){if(narrow.matches)start(p);else {start(pans[0]);start(pans[1],options.introPour+options.introGap);}}}
  },{threshold:.35});
  for(const p of pans){visibility.observe(p.card);introduction.observe(p.card);}
  new ResizeObserver(resize).observe(grid);
  for(const p of pans)new ResizeObserver(resize).observe(p.button);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;clearTimeout(timer);grid.dataset.running='false';}else wake();});
  reduced.addEventListener('change',()=>{if(reduced.matches){for(const p of pans){p.drops=[];p.level=Math.max(options.baseLevel,p.level);p.started=p.done=true;p.wave.fill(0);p.velocity.fill(0);}recovery=1;angularVelocity=0;}draw();wake();});
  resize();
}
