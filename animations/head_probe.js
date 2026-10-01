window.RamnetAnimations ??= {};
window.RamnetAnimations.head_probe = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame} = scope;
function initProbe(){
'use strict';
const DATA=window.ramnetHeadTraces;if(!DATA)throw Error('Trace data unavailable');
const diagram=window.ramnetDiagramTheme;
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ease=t=>t*t*(3-2*t);
const cfg={keySlow:4,tokenSeconds:.75,visibleSlots:17,gridSize:400,tokenSize:50,tokenHeight:36,tokenGap:8,roundness:8,packetSize:10,edgeGap:8,lineScale:1.15,traceGain:1.2,keyColor:diagram.colors.sky,informationColor:diagram.colors.purple,neutralColor:'#89919a',writeColor:diagram.colors.red,readColor:diagram.colors.green};
const DEFAULT_TRACES=DATA.presentation.default_traces;
const MAX_TRACE_ROWS=Math.max(...DATA.examples.map(e=>e.token_count));
let scenes=[],lastFrame=0,lastUi=0;
const mono='"SFMono-Regular",Consolas,"Liberation Mono","Microsoft YaHei",monospace';
function rgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${n>>8&255},${n&255},${clamp(a,0,1)})`}
function blendColor(a,b,t){const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return '#'+[16,8,0].map(s=>Math.round(((x>>s)&255)*(1-t)+((y>>s)&255)*t).toString(16).padStart(2,'0')).join('')}
function clean(token){return token.replace(/^▁/,'').replace(/▁/g,'·')||'▁'}
const icons={restart:'<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',down:'<path d="m6 9 6 6 6-6"/>'};
const svg=name=>`<svg viewBox="0 0 24 24">${icons[name]}</svg>`;
class Scene{
 constructor(kind,title){
  this.kind=kind;this.elapsed=0;this.playing=true;this.startSlot=0;this.targetSlot=0;this.tokenCenter=0;this.lastIndex=-1;this.width=0;this.drag=null;this.historyEdge=null;
  this.root=document.createElement('article');this.root.className='case-card';this.root.id='probe-'+kind;this.root.dataset.kind=kind;
  this.root.innerHTML=`<div class="card-head"><div class="case-title">${title}</div><div class="legend"><span><i style="background:var(--write)"></i>Write</span><span><i style="background:var(--read)"></i>Read</span></div></div><div class="viewport" data-el="viewport"><canvas data-el="canvas" role="img" aria-label="${title}: read/write history and slot contents"></canvas><div class="pan" data-el="panControl"><button data-el="panLeft" aria-label="Previous addresses">${svg('left')}</button><input data-el="pan" type="range" step=".1" min="0" max="1023" aria-label="${title} address window"><button data-el="panRight" aria-label="Next addresses">${svg('right')}</button></div><div class="tooltip hidden" data-el="tooltip"></div></div><div class="transport"><div class="transport-top"><div class="transport-buttons"><button data-el="restart" class="icon-btn" aria-label="Restart">${svg('restart')}</button><button data-el="play" class="icon-btn main-play" aria-label="Pause"></button></div></div><div class="selectors"><label><span class="field-label">HEAD</span><select data-el="head" aria-label="${title} head"></select></label><div class="sentence-control"><span class="field-label">Sentence</span><div class="sentence-choice"><div class="sentence-timeline" data-el="scrubber" aria-label="${title} sentence position"><div class="sentence-track" data-el="track"></div><div class="sentence-caret" data-el="caret"></div><input class="sentence-input" data-el="timeline" type="range" min="0" max="1" step=".001" value="0" aria-label="${title} sentence timeline"></div><div class="sentence-picker">${svg('down')}<select data-el="example" aria-label="${title}Sentence"></select></div></div></div></div></div>`;
  $('board').append(this.root);this.el={};for(const e of this.root.querySelectorAll('[data-el]'))this.el[e.dataset.el]=e;this.ctx=this.el.canvas.getContext('2d');
  for(const h of DATA.head_selection[kind])this.el.head.add(new Option(`L${h.layer} · H${h.head}`,`${h.layer}:${h.head}`));
  DATA.examples.filter(e=>e.kind===kind).forEach(e=>this.el.example.add(new Option(e.text,e.example_id)));
  const preferred=DATA.traces.find(t=>t.trace_id===DEFAULT_TRACES[kind]);this.el.head.value=`${preferred.layer}:${preferred.head}`;this.el.example.value=preferred.example_id;
  this.el.head.onchange=()=>this.choose();this.el.example.onchange=()=>this.choose();this.el.play.onclick=()=>this.setPlaying(!this.playing);this.el.restart.onclick=()=>{this.historyEdge=null;this.elapsed=this.playbackStart;this.tokenCenter=this.windowStart;this.lastIndex=-1;this.playing=true;this.focus(true);this.ui()};
  this.el.timeline.oninput=()=>{this.elapsed=+this.el.timeline.value;this.jump(this.pos().i,this.pos().p)};this.el.pan.oninput=()=>this.pan(+this.el.pan.value);this.el.panLeft.onclick=()=>this.pan(this.startSlot-cfg.visibleSlots*.5);this.el.panRight.onclick=()=>this.pan(this.startSlot+cfg.visibleSlots*.5);
  this.events();this.scrubberEvents();this.choose();new ResizeObserver(()=>this.resize()).observe(this.el.viewport);this.root.getRootNode().host?.addEventListener('ramnet:fit',()=>this.resize());this.resize();
 }
 key(i){return this.keys.has(i)}
 duration(i){return cfg.tokenSeconds*(this.key(i)?cfg.keySlow:1)}
 timing(){this.cumulative=[0];for(let i=0;i<this.trace.tokens.length;i++)this.cumulative.push(this.cumulative.at(-1)+this.duration(i));this.total=this.cumulative.at(-1);this.windowStart=0;this.windowEnd=this.trace.tokens.length-1;this.playbackStart=this.cumulative[this.windowStart];this.playbackEnd=this.cumulative[this.windowEnd+1];this.el.timeline.min=0;this.el.timeline.max=this.total;let charEnd=0;this.el.track.replaceChildren(...this.trace.tokens.map((t,i)=>{const e=document.createElement('span');e.className='sentence-fragment'+(this.key(i)?' key':'')+(i>=this.windowStart&&i<=this.windowEnd?' in-window':'');e.textContent=this.trace.text.slice(charEnd,Math.max(charEnd,t.char_end));charEnd=Math.max(charEnd,t.char_end);e.title=t.token;e.dataset.token=i;return e}))}
 pos(){let i=0;while(i<this.trace.tokens.length-1&&this.elapsed>=this.cumulative[i+1])i++;return {i,p:clamp((this.elapsed-this.cumulative[i])/this.duration(i),0,1)}}
 choose(){this.historyEdge=null;const [l,h]=this.el.head.value.split(':').map(Number);this.trace=DATA.traces.find(t=>t.example_id===this.el.example.value&&t.layer===l&&t.head===h);this.keys=new Set([this.trace.source_token_index,this.trace.target_token_index,...(this.trace.word_piece_token_indices||[])]);const pieces=[...new Set(this.trace.word_piece_token_indices||[this.trace.source_token_index,this.trace.target_token_index])].sort((a,b)=>a-b);this.informationSources=new Set(this.kind==='subword_composition'?pieces.slice(0,-1):[this.trace.source_token_index]);this.timing();scope.setCycleDuration?.(Math.max(this.playbackEnd-this.playbackStart,...scenes.map(scene=>scene.playbackEnd-scene.playbackStart)));this.elapsed=this.playbackStart;this.tokenCenter=this.windowStart;this.lastIndex=-1;this.buildContentMarks();this.focus(true);this.ui();this.draw()}
 buildContentMarks(){
  // Track visible input provenance with the measured GSU update gain.
  this.content=[];let key=new Float32Array(1024),known=new Float32Array(1024);
  for(const token of this.trace.tokens){this.content.push({key:key.slice(),known:known.slice()});for(const e of token.write_topk){const g=e.gsu_gain,slot=e.slot;known[slot]=known[slot]*(1-g)+g;key[slot]=key[slot]*(1-g)+(this.informationSources.has(token.index)?g:0)}}
 }
 layout(){const margin=this.width<400?61:76,side=Math.max(135,Math.min(cfg.gridSize,this.width-margin-26));const x=(this.width-side+margin-20)/2,cell=side/cfg.visibleSlots,rowHeight=cell,rows=Math.min(cfg.visibleSlots,MAX_TRACE_ROWS)-4,traceHeight=rows*rowHeight,top=16,panY=top+traceHeight+8,slotY=top+traceHeight+46,tokenY=slotY+105;return {side,x,cell,rowHeight,rows,traceHeight,top,panY,slotY,tokenY,center:x+side/2,height:tokenY+cfg.tokenHeight+15}}
 resize(){const w=this.el.viewport.clientWidth;if(!w)return;const oldWidth=this.width;this.width=w;this.g=this.layout();Object.assign(this.el.panControl.style,{top:this.g.panY+'px',left:this.g.x+'px',width:this.g.side+'px'});const dpr=Math.min(window.devicePixelRatio||1,3),canvas=this.el.canvas,h=this.g.height;if(canvas.width===Math.round(w*dpr)&&canvas.height===Math.round(h*dpr))return;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.height=h+'px';this.ctx.setTransform(dpr,0,0,dpr,0,0);if(oldWidth!==w)this.focus(true);this.draw();this.ui()}
 focus(instant=false,slot=this.trace.focus_slot_ids[0]){this.targetSlot=clamp(slot-Math.floor(cfg.visibleSlots/2),0,1024-cfg.visibleSlots);if(instant)this.startSlot=this.targetSlot}
 pan(value){this.startSlot=this.targetSlot=clamp(value,0,1024-cfg.visibleSlots);this.lastIndex=this.pos().i;this.ui();this.draw()}
 jump(i,p=0){this.historyEdge=null;i=clamp(i,0,this.trace.tokens.length-1);this.elapsed=this.cumulative[i]+this.duration(i)*p;this.playing=false;this.tokenCenter=i;this.lastIndex=i;if(this.key(i))this.focus(true);this.ui();this.draw()}
 step(dt,loop=true){let completed=false;if(this.playing){this.elapsed+=dt;if(this.elapsed>=this.playbackEnd){completed=true;if(loop){this.elapsed=this.playbackStart+(this.elapsed-this.playbackEnd)%(this.playbackEnd-this.playbackStart);this.lastIndex=-1;this.tokenCenter=this.windowStart}else{this.elapsed=this.playbackEnd-1e-7;this.playing=false}}}const {i}=this.pos();if(i!==this.lastIndex){this.lastIndex=i;if(this.key(i)&&!this.drag)this.focus()}const smooth=1-Math.exp(-dt*14);this.tokenCenter+=(i-this.tokenCenter)*smooth;this.startSlot+=(this.targetSlot-this.startSlot)*smooth;if(Math.abs(this.targetSlot-this.startSlot)<.001)this.startSlot=this.targetSlot;this.draw();return completed}
 ui(){const {i,p}=this.pos();window.RamnetRuntime.setPlaybackIcon(this.el.play,this.playing);this.el.timeline.value=this.elapsed;this.el.timeline.setAttribute('aria-valuetext',this.trace.tokens[i].token);this.el.pan.max=1024-cfg.visibleSlots;this.el.pan.value=this.startSlot;for(let j=0;j<this.el.track.children.length;j++)this.el.track.children[j].classList.toggle('active',j===i);const token=this.el.track.children[i];if(token){const box=token.getBoundingClientRect(),root=this.el.scrubber.getBoundingClientRect(),scale=root.width?this.el.scrubber.clientWidth/root.width:1;this.el.caret.style.left=clamp((box.left-root.left+box.width*p)*scale,4,this.el.scrubber.clientWidth-4)+'px';this.el.caret.style.top=(box.top-root.top+3)*scale+'px'}}
 rect(x,y,w,h,fill,stroke,r=cfg.roundness,line=1){const c=this.ctx;c.beginPath();c.roundRect(x,y,w,h,Math.min(r,w/2,h/2));if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke()}}
 text(text,x,y,size=10,color='#b1a7bc',align='center'){const c=this.ctx;c.font=`500 ${size}px ${mono}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.fillText(text,x,y)}
 x(slot){return this.g.x+(slot-this.startSlot+.5)*this.g.cell}
 history(i,p){
  const c=this.ctx,g=this.g,cell=g.cell,rowHeight=g.rowHeight,view=this.historyView(i,p);
  const firstCol=Math.floor(this.startSlot),lastCol=Math.ceil(this.startSlot+cfg.visibleSlots);
  c.save();c.beginPath();c.rect(0,g.top,g.x+g.side,g.traceHeight);c.clip();
  // Move the graph paper, recorded events and token labels as one tape.
  c.translate(0,g.top+g.traceHeight-view.edge*rowHeight);
  for(let j=Math.floor(view.edge-g.rows);j<=view.last;j++){
   const y=j*rowHeight,token=this.trace.tokens[j],reveal=ease(clamp(view.edge-j,0,1));
   c.save();c.globalAlpha=reveal;
   c.save();c.beginPath();c.rect(g.x,y,g.side,rowHeight);c.clip();
   for(let col=firstCol;col<=lastCol;col++)this.rect(this.x(col)-cell/2+.6,y+.6,cell-1.2,rowHeight-1.2,null,'#b8ae9b88',Math.min(cfg.roundness*.2,2),.85);
   if(token){
    const progress=j===i?ease(clamp((p-.06)/.84,0,1)):1;
    const reads=new Map(token.read_topk.map(e=>[e.slot,e.weight])),writes=new Map(token.write_topk.map(e=>[e.slot,e.weight]));
    for(const slot of new Set([...reads.keys(),...writes.keys()])){
     const x=this.x(slot)-cell/2+1,side=cell-2;if(x+side<g.x||x>g.x+g.side)continue;
     const w=writes.get(slot)||0,r=reads.get(slot)||0;
     this.rect(x,y+1,side,rowHeight-2,rgba(cfg.writeColor,Math.min(.97,w*cfg.traceGain)*progress),null,Math.min(cfg.roundness*.18,2));
     this.rect(x,y+1,side,rowHeight-2,rgba(cfg.readColor,Math.min(.97,r*cfg.traceGain)*progress),null,Math.min(cfg.roundness*.18,2));
    }
   }
   c.restore();
   if(token){
    let label=clean(token.token);if(label.length>10)label=label.slice(0,9)+'…';
    this.text(label,g.x-10,y+rowHeight/2,Math.min(9,rowHeight-1),this.key(j)?'#3269a8':'#79869a','right');
   }
   c.restore();
  }
  c.restore();
  const fade=c.createLinearGradient(0,g.top,0,g.top+14);fade.addColorStop(0,'#e8e2d3');fade.addColorStop(1,'#e8e2d300');c.fillStyle=fade;c.fillRect(0,g.top,this.width,14)
 }
 slotState(slot,i,progress){const history=this.content[i],event=this.trace.tokens[i].write_topk.find(e=>e.slot===slot),gain=(event?.gsu_gain||0)*ease(clamp((progress-.78)/.18,0,1)),mass=history.known[slot]*(1-gain)+gain,key=history.key[slot]*(1-gain)+(this.informationSources.has(i)?gain:0),fraction=mass>0?clamp(key/mass,0,1):0;return {mass,key,ordinary:Math.max(0,mass-key),fraction,color:blendColor(cfg.neutralColor,cfg.informationColor,fraction),hasKey:key>1e-7,hasOrdinary:mass-key>1e-7}}
 vectorSize(weight=1){const slotWidth=this.g.cell*.8,scale=Math.min(.7,cfg.packetSize/slotWidth)*(.87+.13*Math.sqrt(clamp(weight,0,1)));return {width:slotWidth*scale,height:31*scale}}
 vector(x,y,width,height,color,border='#e8e2d3d9',alpha=1){const c=this.ctx;c.save();c.globalAlpha=alpha;this.rect(x-width/2,y-height/2,width,height,color,border,Math.min(cfg.roundness*.15,1.5),.7);c.restore()}
 slots(i,p){const g=this.g,c=this.ctx,focus=new Set(this.trace.focus_slot_ids);c.save();c.beginPath();c.rect(g.x-1,g.slotY-20,g.side+2,53);c.clip();for(let slot=Math.floor(this.startSlot);slot<=Math.ceil(this.startSlot+cfg.visibleSlots);slot++){if(slot<0||slot>1023)continue;const x=this.x(slot),state=this.slotState(slot,i,p),key=focus.has(slot)&&state.hasKey,width=g.cell*.8;this.rect(x-width/2,g.slotY,width,31,key?rgba(cfg.keyColor,.16):'#729ed50d',key?cfg.keyColor:'#cbd6e1',Math.min(cfg.roundness*.4,4),key?1.7:1);if(state.mass>0)this.vector(x,g.slotY+15.5,width-4,27,state.color,'#e8e2d366',state.mass);if(key||slot%5===0)this.text(String(slot),x,g.slotY-10,9,key?'#3269a8':'#75859a')}c.restore()}
 routeGeometry(slot,direction,weight,tokenIndex=this.pos().i){const g=this.g,size=this.vectorSize(weight),token={x:g.center+(tokenIndex-this.tokenCenter)*(cfg.tokenSize+cfg.tokenGap),y:g.tokenY-cfg.edgeGap-size.height/2},memory={x:this.x(slot),y:g.slotY+15.5};return {size,a:direction===1?token:memory,b:direction===1?memory:token}}

 curve(a,b,t){const u=1-t,c1={x:a.x,y:a.y+(b.y-a.y)*.48},c2={x:b.x,y:b.y-(b.y-a.y)*.35};return {x:u*u*u*a.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*b.y}}
 transferPhase(p){return {progress:ease(clamp((p-.10)/.68,0,1)),opacity:ease(clamp((p-.025)/.075,0,1))*(1-ease(clamp((p-.78)/.18,0,1)))}}
 extendRoute(a,b,t){
  // De Casteljau subdivision draws only the prefix ending at the vector center.
  const lerp=(u,v)=>({x:u.x+(v.x-u.x)*t,y:u.y+(v.y-u.y)*t}),c1={x:a.x,y:a.y+(b.y-a.y)*.48},c2={x:b.x,y:b.y-(b.y-a.y)*.35},q0=lerp(a,c1),q1=lerp(c1,c2),q2=lerp(c2,b),r0=lerp(q0,q1),r1=lerp(q1,q2),tip=lerp(r0,r1),c=this.ctx;c.beginPath();c.moveTo(a.x,a.y);c.bezierCurveTo(q0.x,q0.y,r0.x,r0.y,tip.x,tip.y);return tip
 }
 routes(i,p){const motion=this.transferPhase(p);if(motion.opacity<=0)return;const c=this.ctx,g=this.g,token=this.trace.tokens[i],sourceKey=this.informationSources.has(i),packets=[];c.save();c.beginPath();c.rect(g.x-12,g.slotY+31+cfg.edgeGap,g.side+24,g.tokenY-g.slotY-31-2*cfg.edgeGap);c.clip();let offLeft=false,offRight=false;
  for(const [direction,events,lineColor] of [[1,token.write_topk,cfg.writeColor],[-1,token.read_topk,cfg.readColor]])for(const event of [...events].sort((a,b)=>a.weight-b.weight)){const x=this.x(event.slot);if(x<g.x){offLeft=true;continue}if(x>g.x+g.side){offRight=true;continue}const {size,a,b}=this.routeGeometry(event.slot,direction,event.weight,i),state=this.slotState(event.slot,i,1),packetStrength=direction===1?event.weight*event.gsu_gain:event.weight*state.mass,packetColor=direction===1?(sourceKey?cfg.informationColor:cfg.neutralColor):state.color,point=this.extendRoute(a,b,motion.progress);c.lineWidth=(.65+event.weight*1.55)*cfg.lineScale;c.strokeStyle=rgba(lineColor,Math.min(.97,event.weight*cfg.traceGain)*motion.opacity);c.stroke();packets.push({point,size,packetColor,packetStrength})}c.restore();for(const {point,size,packetColor,packetStrength} of packets)this.vector(point.x,point.y,size.width,size.height,packetColor,'#e8e2d3d9',packetStrength*motion.opacity);if(offLeft)this.text('‹',g.x-9,g.slotY+79,15,rgba('#bdc8d1',motion.opacity));if(offRight)this.text('›',g.x+g.side+9,g.slotY+79,15,rgba('#bdc8d1',motion.opacity))
 }

 tokens(i){const g=this.g,c=this.ctx,size=cfg.tokenSize,pitch=size+cfg.tokenGap;c.save();c.beginPath();c.rect(0,g.tokenY-8,this.width,cfg.tokenHeight+18);c.clip();for(let j=(i>=this.windowStart&&i<=this.windowEnd?this.windowStart:Math.max(0,i-4));j<=(i>=this.windowStart&&i<=this.windowEnd?this.windowEnd:Math.min(this.trace.tokens.length-1,i+4));j++){const x=g.center+(j-this.tokenCenter)*pitch-size/2;if(x+size<0||x>this.width)continue;const key=this.key(j),active=j===i,color=key?cfg.keyColor:cfg.neutralColor;this.rect(x,g.tokenY,size,cfg.tokenHeight,rgba(color,active?.24:.055),rgba(color,active?1:.25),cfg.roundness,active?1.7:1);const token=clean(this.trace.tokens[j].token);let font=12;c.font=`${font}px ${mono}`;while(c.measureText(token).width>size-8&&font>7){font-=.5;c.font=`${font}px ${mono}`}this.text(token,x+size/2,g.tokenY+cfg.tokenHeight/2,font,active?(key?'#3269a8':'#435b73'):(key?'#587ca8':'#737e89'))}const fade=c.createLinearGradient(0,0,this.width,0);fade.addColorStop(0,'#e8e2d3');fade.addColorStop(.09,'#e8e2d300');fade.addColorStop(.91,'#e8e2d300');fade.addColorStop(1,'#e8e2d3');c.fillStyle=fade;c.fillRect(0,g.tokenY-8,this.width,cfg.tokenHeight+18);c.restore()}

 draw(){if(!this.width)return;this.g=this.layout();const c=this.ctx,{i,p}=this.pos();c.clearRect(0,0,this.width,this.g.height);this.history(i,p);this.slots(i,p);this.tokens(i);this.routes(i,p)}
 events(){const canvas=this.el.canvas;canvas.dataset.fineInteraction='';canvas.onpointerdown=e=>{const r=canvas.getBoundingClientRect(),scale=this.width/r.width,x=(e.clientX-r.left)*scale,y=(e.clientY-r.top)*scale;this.targetSlot=this.startSlot;this.lastIndex=this.pos().i;this.drag={x,y,start:this.startSlot,history:this.historyView(this.pos().i,this.pos().p).edge,inHistory:y>=this.g.top&&y<=this.g.top+this.g.traceHeight,axis:null,moved:false};canvas.setPointerCapture(e.pointerId);this.el.viewport.classList.add('dragging');this.el.tooltip.classList.add('hidden')};canvas.onpointermove=e=>{const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*this.width/rect.width,y=(e.clientY-rect.top)*this.g.height/rect.height,g=this.g;if(this.drag){const dx=x-this.drag.x,dy=y-this.drag.y;if(!this.drag.axis&&Math.max(Math.abs(dx),Math.abs(dy))>4){this.drag.moved=true;this.drag.axis=this.drag.inHistory&&Math.abs(dy)>Math.abs(dx)?'history':'slots';if(this.drag.axis==='history')this.setPlaying(false)}if(this.drag.axis==='history')this.panHistory(this.drag.history-dy/g.rowHeight);else if(this.drag.axis==='slots'&&this.drag.y<g.tokenY-8)this.pan(this.drag.start-dx/g.cell);return}let text='';if(y>=g.slotY-8&&y<=g.slotY+42&&x>=g.x&&x<g.x+g.side){const s=Math.floor(this.startSlot+(x-g.x)/g.cell),t=this.trace.tokens[this.pos().i];text=`Slot ${s}\nWrite  ${(t.write_topk.find(e=>e.slot===s)?.weight||0).toFixed(5)}\nRead   ${(t.read_topk.find(e=>e.slot===s)?.weight||0).toFixed(5)}`}else if(y>=g.tokenY&&y<=g.tokenY+cfg.tokenHeight){const j=Math.round(this.tokenCenter+(x-g.center)/(cfg.tokenSize+cfg.tokenGap));if(j>=0&&j<this.trace.tokens.length)text=this.trace.tokens[j].token}const tip=this.el.tooltip;if(text){tip.textContent=text;tip.classList.remove('hidden');tip.style.left=clamp(x+9,5,this.width-tip.offsetWidth-5)+'px';tip.style.top=clamp(y-tip.offsetHeight-10,5,g.height-tip.offsetHeight-5)+'px'}else tip.classList.add('hidden')};canvas.onpointerup=e=>{if(!this.drag)return;if(!this.drag.moved&&this.drag.y>=this.g.tokenY-8){const j=Math.round(this.tokenCenter+(this.drag.x-this.g.center)/(cfg.tokenSize+cfg.tokenGap));if(j>=0&&j<this.trace.tokens.length)this.jump(j)}this.drag=null;this.el.viewport.classList.remove('dragging');if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)};canvas.onpointercancel=()=>{this.drag=null;this.el.viewport.classList.remove('dragging')};canvas.onpointerleave=()=>this.el.tooltip.classList.add('hidden');canvas.addEventListener('wheel',e=>{if(Math.abs(e.deltaX)>0||e.shiftKey){e.preventDefault();this.pan(this.startSlot+(e.deltaX||e.deltaY)/this.g.cell)}},{passive:false})}
 setPlaying(value){if(value)this.historyEdge=null;if(value&&(this.elapsed<this.playbackStart||this.elapsed>=this.playbackEnd-1e-6)){this.elapsed=this.playbackStart;this.tokenCenter=this.windowStart;this.lastIndex=-1}this.playing=value;this.ui()}
 historyView(i,p){const live=i+p,edge=this.historyEdge===null?live:clamp(this.historyEdge,Math.min(this.g.rows,live),live);return {edge,first:Math.max(0,Math.floor(edge-this.g.rows)),last:Math.min(i,Math.floor(edge)),following:this.historyEdge===null}}
 panHistory(edge){const {i,p}=this.pos(),live=i+p;this.historyEdge=clamp(edge,Math.min(this.g.rows,live),live);if(this.historyEdge>=live-1e-6)this.historyEdge=null;this.draw()}
 scrubberEvents(){const root=this.el.scrubber;let held=false;const seek=e=>{let nearest=null,best=Infinity;for(let i=0;i<this.el.track.children.length;i++){const span=this.el.track.children[i],box=span.getBoundingClientRect();if(box.width<.1)continue;const dx=Math.max(box.left-e.clientX,0,e.clientX-box.right),dy=Math.max(box.top-e.clientY,0,e.clientY-box.bottom),distance=dx*dx+dy*dy*4;if(distance<best){best=distance;nearest={i,box}}}if(nearest)this.jump(nearest.i,clamp((e.clientX-nearest.box.left)/nearest.box.width,0,.999999))};root.addEventListener('pointerdown',e=>{if(e.button!==0)return;held=true;root.setPointerCapture(e.pointerId);this.el.timeline.focus({preventScroll:true});seek(e);e.preventDefault()});root.addEventListener('pointermove',e=>{if(held)seek(e)});root.addEventListener('pointerup',e=>{held=false;if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId)});root.addEventListener('pointercancel',()=>held=false);this.el.timeline.addEventListener('keydown',e=>{const {i}=this.pos();if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.jump(i+(e.key==='ArrowRight'?1:-1))}else if(e.key==='Home'){e.preventDefault();this.jump(0)}else if(e.key==='End'){e.preventDefault();this.jump(this.trace.tokens.length-1)}})}

}
function frame(now){const dt=lastFrame?Math.min((now-lastFrame)/1000,.08):0;lastFrame=now;if(mobileTabs.matches){const active=scenes.find(scene=>scene.kind===activeKind);if(active.step(dt,false)){const next=scenes.find(scene=>scene!==active);activeKind=next.kind;syncProbeTabs();next.el.restart.click()}}else for(const scene of scenes)scene.step(dt);if(now-lastUi>75){for(const scene of scenes)scene.ui();lastUi=now}requestAnimationFrame(frame)}
for(const [name,key] of [['key','keyColor'],['write','writeColor'],['read','readColor']])document.documentElement.style.setProperty('--'+name,cfg[key]);
scenes=[new Scene('subword_composition','Word pieces'),new Scene('paired_punctuation','Paired punctuation')];
scope.setCycleDuration?.(Math.max(...scenes.map(scene=>scene.playbackEnd-scene.playbackStart)));
const probeTabs=[...document.querySelectorAll('.probe-tabs button')],mobileTabs=window.RamnetRuntime.narrowLayout;
let activeKind=scenes[0].kind;
function syncProbeTabs(){
  for(const scene of scenes)scene.root.hidden=mobileTabs.matches&&scene.kind!==activeKind;
  for(const tab of probeTabs){const active=tab.dataset.kind===activeKind;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
  if(mobileTabs.matches)scenes.find(scene=>scene.kind===activeKind).resize();
}
for(const [index,tab] of probeTabs.entries()){
  tab.onclick=()=>{activeKind=tab.dataset.kind;syncProbeTabs();const active=scenes.find(scene=>scene.kind===activeKind);if(!active.playing&&active.elapsed>=active.playbackEnd-1e-6)active.setPlaying(true)};
  tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?probeTabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+probeTabs.length)%probeTabs.length;probeTabs[next].focus();probeTabs[next].click()};
}
mobileTabs.addEventListener('change',syncProbeTabs);syncProbeTabs();scope.onAutoplayStart?.(event=>{if(!event.detail?.resumeCurrent){scenes.forEach(scene=>scene.el.restart.click());return;}event.detail.remainingMs=Math.max(...scenes.map(scene=>Math.max(0,scene.playbackEnd-scene.elapsed)))*1000;scenes.forEach(scene=>scene.setPlaying(scene.elapsed<scene.playbackEnd-1e-6));lastFrame=0;});requestAnimationFrame(frame);document.addEventListener('visibilitychange',()=>lastFrame=0);
document.querySelector('.probe-loading')?.remove();
probeTabs.forEach(tab=>tab.disabled=false);
}
try{initProbe()}catch(error){console.error(error);const message=document.createElement("p");message.className="probe-error";message.setAttribute("role","alert");message.textContent="Unable to display this probe. Please reload the page.";document.querySelector(".exhibit-root").replaceChildren(message)}
};
if (document.body.classList.contains('probe-heads')) window.RamnetRuntime.mountStandalone('head_probe');
