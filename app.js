/* Original deterministic Canvas 2D world-streaming demonstration. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('world'), ctx = canvas.getContext('2d', { alpha: false });
  const mini = $('mini'), mctx = mini.getContext('2d');
  const W = 100, H = 100, CHUNK_MB = 1.25, LOAD_MS = 470;
  const player = { x: 50, y: 50, vx: 0, vy: 0 }, camera = { x: 50, y: 50 };
  const chunks = new Map(), keys = new Set(), history = [], logs = [];
  const runtimeErrors=[];
  window.addEventListener('error',e=>runtimeErrors.push(e.message||'window error'));
  window.addEventListener('unhandledrejection',e=>runtimeErrors.push(String(e.reason||'unhandled rejection')));
  let running = true, prefetch = true, showGrid = true, showLod = true, logVisible = true;
  let speedScale = 1, budget = 128, hits = 0, misses = 0, evicted = 0, loadTotal = 0, loadCount = 0;
  let last = performance.now(), frameSum = 0, frames = 0, fps = 60, demoStart = 0, demo = false, demoFinished = false, routeEpoch = 0;
  let lastCenterKey = '';
  let initialPrefetchCount = 0;
  let dpr = Math.min(2, window.devicePixelRatio || 1), viewW = 800, viewH = 500;
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const key = (x,y) => `${x},${y}`;
  const seeded = (x,y,s=0) => { let n = (Math.imul(x+101,374761393)+Math.imul(y+37,668265263)+Math.imul(s+19,1442695041))|0; n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296; };
  const bounds = (x,y) => x>=0&&y>=0&&x<W&&y<H;
  function log(type, message) {
    const time = new Date().toLocaleTimeString('en-US',{hour12:false}); logs.unshift({type,message,time}); if(logs.length>22) logs.pop();
    if (logVisible) $('log').innerHTML = logs.slice(0,7).map(e=>`<div class="logline"><span class="time">${e.time}</span><b class="tag ${e.type.toLowerCase()}">[${e.type}]</b> ${e.message}</div>`).join('');
  }
  function flash(message) { const t=$('toastCenter'); t.textContent=message; t.classList.add('show'); clearTimeout(flash.timer); flash.timer=setTimeout(()=>t.classList.remove('show'),2100); }
  function stateAt(x,y) { return chunks.get(key(x,y))?.state || 'UNLOADED'; }
  function getChunk(x,y) { let c=chunks.get(key(x,y)); if(!c){c={x,y,state:'UNLOADED',last:0,requested:0,readyAt:0,kind:kindAt(x,y)};chunks.set(key(x,y),c);} return c; }
  function kindAt(x,y) { const n=seeded(x,y,11); return n<.12?'park':n<.24?'commercial':n<.28?'water':'residential'; }
  function lruEvict(protect) {
    const residents=[...chunks.values()].filter(c=>c.state==='LOADED'&&!protect.has(key(c.x,c.y)));
    residents.sort((a,b)=>a.last-b.last || (a.y-b.y)||(a.x-b.x));
    const c=residents[0]; if(!c)return false;
    c.state='EVICTED'; c.last=performance.now(); evicted++; log('EVICTION',`LRU removed chunk ${c.x},${c.y} · −${CHUNK_MB.toFixed(2)} MB`); return true;
  }
  function enforceBudget(){const protect=new Set();for(let y=Math.floor(player.y)-2;y<=Math.floor(player.y)+2;y++)for(let x=Math.floor(player.x)-2;x<=Math.floor(player.x)+2;x++)protect.add(key(x,y));while([...chunks.values()].filter(c=>c.state==='LOADED').length*CHUNK_MB>budget+.001)if(!lruEvict(protect))break;}
  function request(c, mode, protect, countHit=true) {
    if(c.state==='LOADED'){if(countHit){hits++;c.last=performance.now();}if(mode==='active')c.active=true;return;}
    if(c.state==='LOADING'||c.state==='PREFETCHING') return;
    if(c.state==='EVICTED')evicted=Math.max(0,evicted-1);
    misses++;
    while([...chunks.values()].filter(q=>q.state==='LOADED').length*CHUNK_MB+CHUNK_MB>budget+.001) { if(!lruEvict(protect)) return; }
    c.state=mode==='prefetch'?'PREFETCHING':'LOADING'; c.requested=performance.now(); c.readyAt=c.requested+LOAD_MS+Math.floor(seeded(c.x,c.y,8)*230); c.active=mode==='active';
    if(mode==='active') log('STREAMING',`Chunk ${c.x},${c.y} requested`);
  }
  function activeAndPrefetch() {
    const cx=Math.floor(player.x), cy=Math.floor(player.y), protect=new Set();
    const centerKey=key(cx,cy), centerChanged=centerKey!==lastCenterKey;lastCenterKey=centerKey;
    for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++)if(bounds(x,y))protect.add(key(x,y));
    for(const c of chunks.values()) c.active=false;
    const candidates=[];
    for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++)if(bounds(x,y))candidates.push({x,y,d:(x-cx)**2+(y-cy)**2});
    candidates.sort((a,b)=>a.d-b.d||a.y-b.y||a.x-b.x);
    for(const p of candidates){const c=getChunk(p.x,p.y);request(c,'active',protect,centerChanged);}
    // Chunks outside the demand window become reusable cache entries; trim only under pressure.
    if(prefetch) {
      let dx=Math.sign(player.vx),dy=Math.sign(player.vy); if(!dx&&!dy)dy=-1;
      const forward=[];
      for(let step=1;step<=3;step++) for(let side=-2;side<=2;side++) {
        const x=cx+dx*step+(dy?side:0), y=cy+dy*step+(dx?side:0);
        if(bounds(x,y)&&!protect.has(key(x,y)))forward.push({x,y,step,side});
      }
      forward.sort((a,b)=>a.step-b.step||Math.abs(a.side)-Math.abs(b.side));
      for(const p of forward.slice(0,10)){const c=getChunk(p.x,p.y);if(c.state==='UNLOADED'||c.state==='EVICTED')request(c,'prefetch',protect);}
    }
  }
  function completeLoads(now) {
    for(const c of chunks.values()) if((c.state==='LOADING'||c.state==='PREFETCHING')&&now>=c.readyAt){
      const wasPrefetch=c.state==='PREFETCHING'; const elapsed=now-c.requested;c.state='LOADED';c.last=now;loadTotal+=elapsed;loadCount++;enforceBudget();
      if(!wasPrefetch)log('LOADING',`Chunk ${c.x},${c.y} resident · ${Math.round(elapsed)} ms`);
    }
  }
  function resize(){const r=canvas.getBoundingClientRect();viewW=r.width;viewH=r.height;dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(viewW*dpr);canvas.height=Math.round(viewH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
  function worldColor(x,y){const z=seeded(x,y,3);return z<.12?'#18302d':z<.28?'#1b2c2b':'#192b29';}
  function drawChunk(x,y,size,now,centerX,centerY){
    const c=getChunk(x,y), sx=(x-camera.x)*size+viewW/2, sy=(y-camera.y)*size+viewH/2;
    if(sx>viewW||sy>viewH||sx+size<0||sy+size<0)return null;
    const d=Math.hypot(x+.5-player.x,y+.5-player.y), lod=!showLod||d<2.2?'near':d<4.2?'medium':'far';
    ctx.fillStyle=worldColor(x,y);ctx.fillRect(sx,sy,size+.5,size+.5);
    const road=size*.12;ctx.fillStyle='#34413e';ctx.fillRect(sx,sy,size,road);ctx.fillRect(sx,sy+size-road,size,road);ctx.fillRect(sx,sy,road,size);ctx.fillRect(sx+size-road,sy,road,size);
    ctx.fillStyle='#56605a';ctx.fillRect(sx+size*.49,sy,1,road);ctx.fillRect(sx+size*.49,sy+size-road,1,road);ctx.fillRect(sx,sy+size*.49,road,1);ctx.fillRect(sx+size-road,sy+size*.49,road,1);
    const inset=road+size*.045,bx=sx+inset,by=sy+inset,bw=size-2*inset,bh=size-2*inset;
    const live=c.state==='LOADED',loading=c.state==='LOADING',pending=c.state==='PREFETCHING';
    if(c.kind==='water') {ctx.fillStyle='#163943';ctx.fillRect(bx,by,bw,bh);if(lod==='near'){ctx.strokeStyle='#4c899080';ctx.lineWidth=.7;for(let k=0;k<4;k++){ctx.beginPath();ctx.moveTo(bx+5,by+7+k*6);ctx.quadraticCurveTo(bx+bw*.5,by+4+k*6,bx+bw-5,by+8+k*6);ctx.stroke();}}}
    else if(c.kind==='park') {
      ctx.fillStyle='#264735';ctx.fillRect(bx,by,bw,bh);ctx.fillStyle='#456d4b';ctx.fillRect(bx+bw*.4,by,bw*.13,bh);ctx.fillRect(bx,by+bh*.47,bw,bh*.12);
      if(lod==='near')for(let n=0;n<5;n++){let tx=bx+size*.1+seeded(x,y,n+20)*bw*.8,ty=by+size*.1+seeded(y,x,n+22)*bh*.8;ctx.fillStyle='#416f4b';ctx.beginPath();ctx.arc(tx,ty,size*.035,0,7);ctx.fill();ctx.fillStyle='#71945b';ctx.beginPath();ctx.arc(tx-1,ty-1,size*.018,0,7);ctx.fill();}
    } else {
      const count=c.kind==='commercial'?3:4, gap=size*.035, cols=count, rows=count;
      for(let iy=0;iy<rows;iy++)for(let ix=0;ix<cols;ix++){
        const n=seeded(x,y,ix*11+iy*17+29), pad=size*.025, rw=(bw-(cols-1)*gap)/cols, rh=(bh-(rows-1)*gap)/rows;
        const rx=bx+ix*(rw+gap)+pad,ry=by+iy*(rh+gap)+pad,w=rw-2*pad,h=rh-2*pad;
        const tall=c.kind==='commercial'?.58+.38*n:.32+.4*n;
        if(lod==='far') {ctx.fillStyle=c.kind==='commercial'?'#788879':'#6b8374';ctx.fillRect(rx,ry,w,h);}
        else {
          const shades=c.kind==='commercial'?['#667a73','#71827a','#526b69']:['#788171','#69786d','#68766b'];
          const bodyH=h*tall,base=ry+h-bodyH;
          ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(rx+2,base+3,w,bodyH);
          ctx.fillStyle=shades[Math.floor(n*shades.length)];ctx.fillRect(rx,base,w,bodyH);
          ctx.fillStyle=c.kind==='commercial'?'#a4b28f':'#b2aa86';ctx.fillRect(rx,base,w,Math.max(1,size*.018));
          if(lod==='near'){
            ctx.fillStyle='#243c3b';for(let wx=1;wx<3;wx++)for(let wy=1;wy<3;wy++){if(seeded(x+wx,y+wy,ix+iy)<.72)ctx.fillRect(rx+w*wx/3,base+bodyH*wy/3,Math.max(1,size*.017),Math.max(1,size*.022));}
            if(c.kind==='commercial'&&n>.3){ctx.fillStyle='#cf9970';ctx.fillRect(rx+w*.2,base+bodyH*.78,w*.6,Math.max(1,size*.022));}
          }
        }
      }
      if(lod==='near'&&c.kind==='residential'){for(let n=0;n<3;n++){let tx=bx+seeded(x,y,n+50)*bw,ty=by+seeded(y,x,n+51)*bh;ctx.fillStyle='#537952';ctx.beginPath();ctx.arc(tx,ty,size*.024,0,7);ctx.fill();}}
    }
    if(showGrid){ctx.strokeStyle='rgba(142,179,154,.16)';ctx.lineWidth=.65;ctx.strokeRect(sx+.5,sy+.5,size-1,size-1);}
    const overlayColor=loading?'#d99b6138':pending?'#78afb340':live?'#7db9a642':c.state==='EVICTED'?'#c77c6950':null;
    if(overlayColor){ctx.fillStyle=overlayColor;ctx.fillRect(sx,sy,size,size);if(loading||pending){ctx.strokeStyle=loading?'#d99b61':'#78afb3';ctx.lineWidth=1.2;ctx.strokeRect(sx+1,sy+1,size-2,size-2);}}
    return {lod, sx,sy,size, c};
  }
  function render(now){
    ctx.fillStyle='#0b1415';ctx.fillRect(0,0,viewW,viewH);
    const size=Math.max(38,Math.min(65,Math.min(viewW/10.5,viewH/7.4)));
    camera.x+=(player.x-camera.x)*.10;camera.y+=(player.y-camera.y)*.10;
    const minX=Math.max(0,Math.floor(camera.x-viewW/size/2)-1),maxX=Math.min(W-1,Math.ceil(camera.x+viewW/size/2)+1),minY=Math.max(0,Math.floor(camera.y-viewH/size/2)-1),maxY=Math.min(H-1,Math.ceil(camera.y+viewH/size/2)+1);
    let near=0,med=0,far=0,objects=0;
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const r=drawChunk(x,y,size,now);if(r){if(r.lod==='near')near++;else if(r.lod==='medium')med++;else far++;if(r.lod==='near')objects+=r.c.kind==='park'?6:r.c.kind==='water'?4:16;else if(r.lod==='medium')objects+=r.c.kind==='park'?2:r.c.kind==='water'?1:5;else objects+=1;}}
    // Directional prediction fan and heading marker.
    if(prefetch&&(player.vx||player.vy)){ctx.save();ctx.translate(viewW/2,viewH/2);ctx.rotate(Math.atan2(player.vy,player.vx)+Math.PI/2);ctx.strokeStyle='#78afb377';ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-8,-10);ctx.lineTo(0,-49);ctx.lineTo(8,-10);ctx.stroke();ctx.restore();}
    const phase=now*.002,px=viewW/2,py=viewH/2;
    const glow=ctx.createRadialGradient(px,py,1,px,py,26);glow.addColorStop(0,'#e2c57b99');glow.addColorStop(1,'#d7b87300');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(px,py,26,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(px,py);ctx.rotate(Math.atan2(player.vy,player.vx)+Math.PI/2);
    ctx.fillStyle='#e5ca84';ctx.shadowColor='#d7b873';ctx.shadowBlur=10;ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(6,6);ctx.lineTo(0,3);ctx.lineTo(-6,6);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.restore();
    // Animated, low-cost beacon ring communicates active cell and motion.
    ctx.strokeStyle=`rgba(215,184,115,${.22+.1*Math.sin(phase)})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(px,py,14+Math.sin(phase)*1.3,0,Math.PI*2);ctx.stroke();
    drawMinimap();
    $('nearCount').textContent=near;$('medCount').textContent=med;$('farCount').textContent=far;$('objects').textContent=objects.toLocaleString();
    const total=Math.max(1,near+med+far);$('nearBar').style.width=`${near/total*100}%`;$('medBar').style.width=`${med/total*100}%`;$('farBar').style.width=`${far/total*100}%`;
  }
  function drawMinimap(){mctx.clearRect(0,0,mini.width,mini.height);mctx.fillStyle='#0d171b';mctx.fillRect(0,0,mini.width,mini.height);const sx=mini.width/11,sy=mini.height/7.2;const cx=Math.floor(player.x),cy=Math.floor(player.y);for(let y=-3;y<=3;y++)for(let x=-5;x<=5;x++){const wx=cx+x,wy=cy+y;if(!bounds(wx,wy))continue;let color='#20302d';const st=stateAt(wx,wy);if(st==='LOADED')color='#56816b';if(st==='LOADING')color='#d99b61';if(st==='PREFETCHING')color='#78afb3';if(st==='EVICTED')color='#a56e5d';mctx.fillStyle=color;mctx.fillRect((x+5)*sx,(y+3)*sy,sx-1,sy-1);}mctx.fillStyle='#e5ca84';mctx.beginPath();mctx.arc(5.5*sx,3.5*sy,2.2,0,7);mctx.fill();if(player.vx||player.vy){mctx.strokeStyle='#e5ca8499';mctx.beginPath();mctx.moveTo(5.5*sx,3.5*sy);mctx.lineTo(5.5*sx+player.vx*4,3.5*sy+player.vy*4);mctx.stroke();}}
  function updateMetrics(now,dt){
    const all=[...chunks.values()],loaded=all.filter(c=>c.state==='LOADED').length,pref=all.filter(c=>c.state==='PREFETCHING'||c.state==='LOADING').length,mem=loaded*CHUNK_MB,rate=(hits+misses)?hits/(hits+misses)*100:0;
    $('unloaded').textContent=Math.max(0,W*H-loaded-pref-evicted).toLocaleString();$('evictedCount').textContent=evicted.toLocaleString();
    $('loaded').textContent=loaded.toString().padStart(2,'0');$('prefetched').textContent=pref.toString().padStart(2,'0');$('hits').textContent=hits;$('misses').textContent=misses;$('hitRate').textContent=`${rate.toFixed(0)}%`;
    $('memory').textContent=mem.toFixed(1);$('budgetLabel').textContent=budget;$('memoryPct').textContent=`${Math.min(100,mem/budget*100).toFixed(0)}%`;$('memoryBar').style.width=`${Math.min(100,mem/budget*100)}%`;$('memoryBar').style.background=mem/budget>.85?'linear-gradient(90deg,#d98d62,#ed6969)':'';
    $('latency').innerHTML=`${loadCount?(loadTotal/loadCount).toFixed(0):'—'} <small>ms</small>`;$('fps').textContent=fps;$('frameTime').textContent=(dt*1000).toFixed(1);
    $('coords').textContent=`${player.x.toFixed(2)}, ${player.y.toFixed(2)}`;$('coordHud').textContent=`X ${player.x.toFixed(1)} · Y ${player.y.toFixed(1)}`;$('speed').textContent=(Math.hypot(player.vx,player.vy)*12).toFixed(1);$('heading').textContent=player.vy<-.1?'NORTH':player.vy>.1?'SOUTH':player.vx>.1?'EAST':player.vx<-.1?'WEST':'NORTH';
    $('clock').textContent=new Date().toLocaleTimeString('en-US',{hour12:false});
  }
  function guidedRoute(t){
    const phase=t<5?'overview':t<15?'grid':t<26?'traverse':t<37?'prefetch':t<48?'memory':t<58?'lod':t<66?'summary':'closing';
    if(phase==='overview'||phase==='grid'){player.vx=player.vy=0;}
    else if(phase==='traverse'){player.vx=.3;player.vy=-.72;}
    else if(phase==='prefetch'){player.vx=.75;player.vy=-.18;}
    else if(phase==='memory'){player.vx=.7;player.vy=.4;if(t>=37){budget=48;$('budgetSlider').value=48;$('budgetValue').textContent='48';$('budgetLabel').textContent='48';enforceBudget();}}
    else if(phase==='lod'){player.vx=-.63;player.vy=.34;}
    else {player.vx=player.vy=0;}
    if(phase==='grid'&&!routeEpoch){showGrid=true;setToggle('gridToggle',true);routeEpoch=1;log('STREAMING','10,000 chunks indexed across a deterministic city grid');}
    if(phase==='prefetch'&&routeEpoch<2){prefetch=true;setChip('prefetchToggle',true);routeEpoch=2;log('PREFETCH','Predicting movement east · preparing nearby chunks');flash('VELOCITY VECTOR DETECTED · PREFETCH ENABLED');}
    if(phase==='memory'&&routeEpoch<3){routeEpoch=3;log('CACHE','Memory budget reduced · LRU pressure demonstration');flash('MEMORY PRESSURE · LRU EVICTION ACTIVE');}
    if(phase==='lod'&&routeEpoch<4){routeEpoch=4;log('LOD','Distant geometry simplified · fewer draw objects');flash('LOD ACTIVE · REDUCED DISTANT GEOMETRY');}
    if(phase==='closing'&&!demoFinished){demoFinished=true;$('closing').classList.add('show');$('runState').textContent='DEMO COMPLETE';}
  }
  function applyKeyboardVelocity(){let ix=0,iy=0;for(const k of keys){if(k==='w'||k==='arrowup')iy--;if(k==='s'||k==='arrowdown')iy++;if(k==='a'||k==='arrowleft')ix--;if(k==='d'||k==='arrowright')ix++;}const mag=Math.hypot(ix,iy)||1;player.vx=ix/mag*.43*speedScale;player.vy=iy/mag*.43*speedScale;}
  function tick(now){
    const dt=Math.min(.05,(now-last)/1000);last=now;frameSum+=dt;frames++;if(frameSum>=.5){fps=Math.round(frames/frameSum);frames=0;frameSum=0;}
    if(demo){const t=(now-demoStart)/1000;guidedRoute(t);}
    if(running){if(!demo)applyKeyboardVelocity();
      player.x=clamp(player.x+player.vx*dt,1,98);player.y=clamp(player.y+player.vy*dt,1,98);
      activeAndPrefetch();completeLoads(now);
    }else{player.vx=player.vy=0;completeLoads(now);}
    render(now);updateMetrics(now,dt);requestAnimationFrame(tick);
  }
  function setToggle(id,on){$(id).classList.toggle('active',on);}
  function setChip(id,on){$(id).classList.toggle('selected',on);$(id).querySelector('.on').textContent=on?'ON':'OFF';}
  function reset(){chunks.clear();logs.length=0;hits=misses=evicted=loadCount=loadTotal=0;player.x=50;player.y=50;player.vx=player.vy=0;camera.x=50;camera.y=50;budget=128;$('budgetSlider').value=128;$('budgetValue').textContent='128';$('budgetLabel').textContent='128';prefetch=true;setChip('prefetchToggle',true);routeEpoch=0;lastCenterKey='';demoFinished=false;$('closing').classList.remove('show');if(demo){demoStart=performance.now();$('runState').textContent='DEMO IN PROGRESS';}log('STREAMING','World initialized · 10,000 chunks addressable');activeAndPrefetch();}
  window.__streamEngine={player,chunks,activeAndPrefetch,completeLoads,lruEvict,getChunk,stateAt,counts:()=>{const a=[...chunks.values()];return{loaded:a.filter(c=>c.state==='LOADED').length,loading:a.filter(c=>c.state==='LOADING').length,prefetching:a.filter(c=>c.state==='PREFETCHING').length,evicted,misses,hits,budget,chunkMB:CHUNK_MB,initialPrefetchCount};},setBudget:n=>{budget=n;},setPrefetch:n=>{prefetch=n;},stepManual:dt=>{applyKeyboardVelocity();player.x=clamp(player.x+player.vx*dt,1,98);player.y=clamp(player.y+player.vy*dt,1,98);},moveTo:(x,y)=>{player.x=x;player.y=y;player.vx=.4;player.vy=-.2;activeAndPrefetch();},renderNow:()=>{completeLoads(performance.now()+10000);render(performance.now());updateMetrics(performance.now(),1/60);}};
  if(new URLSearchParams(location.search).get('test')==='1')setTimeout(()=>{
    const E=window.__streamEngine, checks=[];const check=(name,ok)=>checks.push({name,ok:!!ok});
    check('predictive chunks enter prefetch queue',E.counts().initialPrefetchCount>0);
    const startX=E.player.x;window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));E.stepManual(.1);window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}));check('keyboard movement updates player position',E.player.x>startX);
    E.completeLoads(performance.now()+10000);const before=E.counts();check('active chunks finish loading',before.loaded>0);
    E.setBudget(32);E.moveTo(60,60);E.completeLoads(performance.now()+20000);const after=E.counts();check('LRU evicts under a tight memory budget',after.evicted>0);check('memory stays within hard budget',after.loaded*after.chunkMB<=after.budget+.001);
    check('world coordinates remain in bounds',E.player.x>=0&&E.player.x<100&&E.player.y>=0&&E.player.y<100);
    E.renderNow();check('LOD distribution updates',document.getElementById('nearCount').textContent!=='—'&&document.getElementById('farCount').textContent!=='—');check('dashboard reports resident chunk count',document.getElementById('loaded').textContent!=='—');check('Reyas Khan signature is present',document.querySelector('.signature').textContent.includes('Reyas Khan'));check('primary controls use oval styling',getComputedStyle(document.querySelector('.primary')).borderRadius==='999px');check('no browser JavaScript runtime errors',runtimeErrors.length===0);
    document.body.insertAdjacentHTML('beforeend',`<pre id="testResults" style="position:fixed;z-index:99;inset:20px auto auto 20px;background:#080d12;color:#b9f05a;padding:18px;border:1px solid #526c3e;font:14px monospace">${checks.map(c=>`${c.ok?'PASS':'FAIL'} ${c.name}`).join('\n')}\n${checks.filter(c=>c.ok).length}/${checks.length} passed</pre>`);
  },100);
  $('playBtn').addEventListener('click',()=>{running=!running;$('playIcon').textContent=running?'Ⅱ':'▶';$('playText').textContent=running?'PAUSE ENGINE':'RESUME ENGINE';$('runState').textContent=running?'ENGINE ONLINE':'ENGINE PAUSED';if(!running){player.vx=player.vy=0;log('STREAMING','Simulation paused');}else log('STREAMING','Simulation resumed');});
  $('resetBtn').addEventListener('click',()=>{demo=false;running=true;$('runState').textContent='ENGINE ONLINE';$('playIcon').textContent='Ⅱ';$('playText').textContent='PAUSE ENGINE';reset();});
  $('gridToggle').addEventListener('click',()=>{showGrid=!showGrid;setToggle('gridToggle',showGrid);});$('lodToggle').addEventListener('click',()=>{showLod=!showLod;setToggle('lodToggle',showLod);});
  $('prefetchToggle').addEventListener('click',()=>{prefetch=!prefetch;setChip('prefetchToggle',prefetch);log('PREFETCH',`Predictive prefetch ${prefetch?'enabled':'disabled'}`);});
  $('logToggle').addEventListener('click',()=>{logVisible=!logVisible;$('eventPanel').style.opacity=logVisible?'1':'.3';$('eventPanel').style.visibility=logVisible?'visible':'hidden';$('logToggle').classList.toggle('selected',logVisible);$('logToggle').querySelector('.on').textContent=logVisible?'ON':'OFF';});
  $('clearLog').addEventListener('click',()=>{logs.length=0;$('log').innerHTML='';});
  $('speedSlider').addEventListener('input',e=>{speedScale=+e.target.value;$('speedValue').textContent=speedScale.toFixed(1);});
  $('budgetSlider').addEventListener('input',e=>{budget=+e.target.value;$('budgetValue').textContent=budget;$('budgetLabel').textContent=budget;enforceBudget();});
  $('demoBtn').addEventListener('click',()=>startDemo());$('replayBtn').addEventListener('click',()=>startDemo());
  function startDemo(){demo=true;running=true;$('closing').classList.remove('show');$('playIcon').textContent='Ⅱ';$('playText').textContent='PAUSE ENGINE';$('runState').textContent='DEMO IN PROGRESS';demoStart=performance.now();routeEpoch=0;demoFinished=false;budget=128;$('budgetSlider').value=128;$('budgetValue').textContent='128';$('budgetLabel').textContent='128';reset();demo=true;demoStart=performance.now();}
  window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)){if(k===' '){e.preventDefault();$('playBtn').click();return;}keys.add(k);e.preventDefault();}});
  window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());window.addEventListener('resize',resize);
  resize();log('STREAMING','World initialized · 10,000 chunks addressable');activeAndPrefetch();initialPrefetchCount=[...chunks.values()].filter(c=>c.state==='PREFETCHING').length;requestAnimationFrame(tick);
  if(new URLSearchParams(location.search).get('demo')==='1')setTimeout(startDemo,900);
})();
