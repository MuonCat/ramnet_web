window.RamnetAnimations ??= {};
window.RamnetAnimations.cape = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame} = scope;
'use strict';
const diagram=window.ramnetDiagramTheme;
// This diagram isolates address overlap; it does not simulate PDMA or memory normalization.
// CAPE follows [P_t(a)]_i = a[(i + t) mod N], with writes at 0..T-1 and a read at T.
const $ = id => document.getElementById(id);
const editorHeight=294,minimumSegment=8,minimumProbability=minimumSegment/editorHeight;
const defaults = {N:8,T:24,writeConcentration:.65,readConcentration:.65,writeBase:null,readBase:null,writeOverride:null,readOverrideCape:0,duration:22,writeDuration:6,readDuration:2,capeDuration:2,readAdjustDuration:6,writeAdjustDuration:6,speed:1,loop:true,aspectRatio:1.8,fontScale:1.25,gap:6,cellRadius:4,panelRadius:18,spacing:20,intensity:1};
let params={...defaults}, progress=0, playing=true, previous=0, hovered=-1, toastTimer, roundMotion;
let hoverPaused=false, capeOverride=null, capeTransition=null;
let distributionDrag=null;
let adjustmentRestarts={3:null,4:null}, pendingAdjustment=null;
const stages=[
 {name:'逐列写入',key:'writeDuration',preview:.6875,range:[2,12,.5]},
 {name:'读取历史',key:'readDuration',preview:.75,range:[.5,4,.1]},
 {name:'开启 CAPE',key:'capeDuration',preview:.85,range:[.5,4,.1]},
 {name:'调整读取',key:'readAdjustDuration',preview:.85,range:[2,12,.5]},
 {name:'调整写入',key:'writeAdjustDuration',preview:.75,range:[2,12,.5]}
];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mod=(x,n)=>((x%n)+n)%n;
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const ramp=(p,a,b)=>smooth((p-a)/(b-a));
const lerp=(a,b,t)=>a+(b-a)*t;
const format=x=>Number.isInteger(x)?String(x):String(Number(x.toFixed(2)));
function stageProgress(p,index){const stage=stages[index];return clamp((p-stage.start)/(stage.end-stage.start))}
function syncTiming(){
 params.duration=Number(stages.reduce((sum,stage)=>sum+params[stage.key],0).toFixed(1));
 scope.setCycleDuration?.(params.duration/params.speed);
 let elapsed=0;
 stages.forEach((stage,i)=>{
  stage.start=elapsed/params.duration;elapsed+=params[stage.key];stage.end=i===stages.length-1?1:elapsed/params.duration;
  stage.at=lerp(stage.start,stage.end,stage.preview);

 });
}
function syncControls(){syncTiming();document.documentElement.style.setProperty('--font-scale',params.fontScale);}
function protectDistribution(values){
 const free=values.map(value=>Math.max(0,value-minimumProbability)),sum=free.reduce((a,b)=>a+b,0),available=1-values.length*minimumProbability;
 return free.map(value=>minimumProbability+available*(sum>0?value/sum:1/values.length));
}
function randomDistribution(side){
 const peak=Math.floor(Math.random()*params.N),concentration=params[side+'Concentration'];
 const weights=Array.from({length:params.N},(_,i)=>i===peak?0:.12+Math.random()**2),sum=weights.reduce((a,b)=>a+b,0);
 const available=1-params.N*minimumProbability;
 return weights.map((value,i)=>minimumProbability+available*(i===peak?concentration:(1-concentration)*value/sum));
}
function randomMotion(){
 const min=Math.ceil(params.N*.3),max=Math.floor(params.N*.5);
 // Land close to slot centers so the settled distribution stays concentrated.
 return {distance:(Math.random()<.5?-1:1)*(min+Math.floor(Math.random()*(max-min+1))),offsets:Array.from({length:params.N},()=>.24*(Math.random()-.5))};
}
function moveDistribution(values,motion,progress){
 if(!motion||progress<=0)return values.slice();
 const t=smooth(progress),moved=Array(values.length).fill(minimumProbability);
 // Transport probability between neighboring slots; never crossfade endpoint distributions.
 values.forEach((value,i)=>{
  const position=i+(motion.distance+motion.offsets[i])*t,slot=Math.floor(position),fraction=smooth(position-slot),mass=Math.max(0,value-minimumProbability);
  moved[mod(slot,values.length)]+=mass*(1-fraction);
  moved[mod(slot+1,values.length)]+=mass*fraction;
 });
 return moved;
}
function beginRound(randomizeBase=true){
 capeOverride=null;capeTransition=null;distributionDrag=null;
 adjustmentRestarts={3:null,4:null};pendingAdjustment=null;
 if(randomizeBase){
  params.writeOverride=null;params.readOverride=null;params.readOverrideCape=0;
 }
 for(const side of ['write','read'])if(randomizeBase||!params[side+'Base'])params[side+'Base']=randomDistribution(side);
 // Keep one draw per round so rendering and timeline scrubbing never reroll it.
 roundMotion={write:randomMotion(),read:randomMotion()};
 syncControls();
}
// Fractional shifts interpolate adjacent permutations only during the visual transition.
function shift(vector,amount){const n=vector.length,k=Math.floor(amount),f=amount-k;return vector.map((_,i)=>lerp(vector[mod(i+k,n)],vector[mod(i+k+1,n)],f))}
function model(p){
 const wf=stageProgress(p,4),rf=stageProgress(p,3);
 const cape=capeOverride??ramp(stageProgress(p,2),.05,.725);
 let write=params.writeBase;
 let read=shift(moveDistribution(params.readBase,roundMotion.read,rf),cape*params.T);
 const readRestart=adjustmentRestarts[3],writeRestart=adjustmentRestarts[4];
 if(readRestart&&p>=stages[3].start){
  write=moveDistribution(readRestart.writeFrom,readRestart.writeMotion,rf);
  read=shift(moveDistribution(readRestart.readFrom,readRestart.readMotion,rf),(cape-readRestart.cape)*params.T);
 }
 if(writeRestart&&p>=stages[4].start){
  write=moveDistribution(writeRestart.writeFrom,writeRestart.writeMotion,wf);
  read=shift(moveDistribution(writeRestart.readFrom,writeRestart.readMotion,wf),(cape-writeRestart.cape)*params.T);
 }else write=moveDistribution(write,roundMotion.write,wf);
 if(params.writeOverride)write=params.writeOverride;
 if(params.readOverride)read=shift(params.readOverride,(cape-params.readOverrideCape)*params.T);
 const columns=Array.from({length:params.T},(_,t)=>shift(write,cape*t));
 const response=columns.map(column=>column.reduce((sum,x,i)=>sum+x*read[i],0));
 return {write,read,columns,response,cape,writeProgress:clamp(stageProgress(p,0)/.9375)*params.T,readAlpha:ramp(stageProgress(p,1),1/24,3/8),responseAlpha:ramp(stageProgress(p,1),7/24,5/8)};
}
const colors={red:diagram.colors.red,green:diagram.colors.green,gray:'#7e897a'};
function color(name,value){const c=colors[name],f=clamp(value*params.intensity);return diagram.rgba(c,f*diagram.alpha.strong)}
const svgNS='http://www.w3.org/2000/svg';
let nodes,geometry;
function element(tag,attrs,parent){const el=document.createElementNS(svgNS,tag);for(const key in attrs)el.setAttribute(key,attrs[key]);parent.append(el);return el}
function rect(parent,x,y,w,h,fill,stroke='none'){return element('rect',{x,y,width:w,height:h,rx:Math.min(params.cellRadius,w/2,h/2),fill,stroke,'stroke-width':1.1},parent)}
function label(parent,x,y,text,cls='',anchor='middle',edge='baseline'){
 const el=element('text',{x,y,'text-anchor':anchor,class:cls},parent);el.textContent=text;
 if(edge!=='baseline'){
  const box=el.getBBox();el.setAttribute('y',y+y-box.y-(edge==='bottom'?box.height:edge==='center'?box.height/2:0));
 }
 return el;
}
function path(parent,d,stroke,width=1,extra={}){return element('path',{d,fill:'none',stroke,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round',...extra},parent)}
function createDistributionEditor(parent,side,x,y,height){
 const group=element('g',{class:'dist-editor','aria-label':side==='write'?'Write distribution editor':'Read distribution editor'},parent);
 const tone=side==='write'?'red':'green',editor={x,y,height,segments:[],dividers:[]},gripScale=height/editorHeight;
 const clip=element('clipPath',{id:side+'-dist-clip'},group);
 rect(clip,x,y,22,height,'#fff');
 const fills=element('g',{'clip-path':`url(#${side}-dist-clip)`},group);
 for(let i=0;i<params.N;i++){
  const segment=element('rect',{x,y,width:22,height:0,fill:color(tone,.35+.6*i/(params.N-1)),class:'dist-segment',tabindex:window.ramnetCompactInteractions.matches?-1:0,role:'slider','aria-label':`${side==='write'?'Write':'Read'} address ${i} weight`,'aria-orientation':'horizontal','aria-valuemin':minimumProbability*100,'aria-valuemax':(1-(params.N-1)*minimumProbability)*100},fills);
  element('title',{},segment).textContent=`Address ${i}: drag right to increase, left to decrease`;
  bindDistributionDrag(segment,side,'segment',i);
  editor.segments.push(segment);
 }
 rect(group,x,y,22,height,'none',color(tone,.8)).setAttribute('pointer-events','none');
 for(let i=0;i<params.N-1;i++){
  const divider=element('g',{class:'dist-divider',tabindex:window.ramnetCompactInteractions.matches?-1:0,role:'slider','aria-label':`${side==='write'?'Write':'Read'} boundary between addresses ${i} and ${i+1}`,'aria-orientation':'vertical'},group);
  element('rect',{x:-7,y:-3*gripScale,width:36,height:6*gripScale,fill:'transparent'},divider);
  element('rect',{x:-3,y:-2*gripScale,width:28,height:4*gripScale,rx:2*gripScale,fill:'#e8e2d3',stroke:color(tone,.9),class:'dist-grip'},divider);
  path(divider,'M 7 0 H 15',color(tone,.9),1.2,{'pointer-events':'none'});
  element('title',{},divider).textContent='Drag vertically to adjust adjacent address weights';
  bindDistributionDrag(divider,side,'divider',i);
  editor.dividers.push(divider);
 }
 return editor;
}
function renderDistributionEditor(editor,values){
 let cumulative=0;
 values.forEach((value,i)=>{
  const segment=editor.segments[i];
  segment.setAttribute('y',editor.y+cumulative*editor.height);segment.setAttribute('height',value*editor.height);
  segment.setAttribute('aria-valuenow',(value*100).toFixed(2));
  cumulative+=value;
  if(i<values.length-1){
   const divider=editor.dividers[i];
   divider.setAttribute('transform',`translate(${editor.x} ${editor.y+cumulative*editor.height})`);
   divider.setAttribute('aria-valuemin',((cumulative-value+minimumProbability)*100).toFixed(2));
   divider.setAttribute('aria-valuemax',((cumulative+values[i+1]-minimumProbability)*100).toFixed(2));
   divider.setAttribute('aria-valuenow',(cumulative*100).toFixed(2));
  }
 });
}
function editDistribution(values,kind,index,delta){
 const next=values.slice();
 if(kind==='divider'){
  const total=values[index]+values[index+1];
  next[index]=clamp(values[index]+delta,minimumProbability,total-minimumProbability);next[index+1]=total-next[index];
 }else{
  next[index]=clamp(values[index]+delta,minimumProbability,1-(values.length-1)*minimumProbability);
  const remaining=1-values[index]-(values.length-1)*minimumProbability,available=1-next[index]-(values.length-1)*minimumProbability;
  for(let i=0;i<values.length;i++)if(i!==index)next[i]=minimumProbability+available*(remaining>1e-12?Math.max(0,values[i]-minimumProbability)/remaining:1/(values.length-1));
 }
 return next;
}
function applyDistribution(side,values){
 const current=model(progress);
 if(values.every((value,i)=>Math.abs(value-current[side][i])<1e-9))return;
 if(progress>=stages[3].start){
  const stage=progress<stages[4].start?3:4;
  if(!pendingAdjustment||pendingAdjustment.stage!==stage)pendingAdjustment={stage,sides:new Set()};
  pendingAdjustment.sides.add(side);
 }
 if(side==='read')params.readOverrideCape=current.cape;
 params[side+'Override']=values;
 render();
}
function restartEditedAdjustment(){
 const {stage,sides}=pendingAdjustment,current=model(progress);
 sides.add(stage===3?'read':'write');
 // Anchor motion in the visible address coordinates to avoid a CAPE jump.
 adjustmentRestarts[stage]={
  writeFrom:current.write.slice(),writeMotion:sides.has('write')?randomMotion():null,
  readFrom:current.read.slice(),readMotion:sides.has('read')?randomMotion():null,
  cape:current.cape
 };
 if(stage===3)adjustmentRestarts[4]=null;
 for(const side of sides)params[side+'Override']=null;
 progress=stages[stage].start;pendingAdjustment=null;
}
function scenePoint(event){return new DOMPoint(event.clientX,event.clientY).matrixTransform($('scene').getScreenCTM().inverse())}
function bindDistributionDrag(control,side,kind,index){
 control.addEventListener('pointerdown',event=>{
  if(window.ramnetCompactInteractions.matches||event.button!==0||distributionDrag)return;
  event.preventDefault();event.stopPropagation();
  pauseForHover({pointerType:'mouse'});
  distributionDrag={side,kind,index,start:scenePoint(event),values:model(progress)[side].slice(),pointerId:event.pointerId,control};
  control.setPointerCapture(event.pointerId);
 });
 control.addEventListener('pointermove',event=>{
  const drag=distributionDrag;if(!drag||drag.control!==control||drag.pointerId!==event.pointerId)return;
  const point=scenePoint(event),delta=kind==='divider'?(point.y-drag.start.y)/geometry.distHeight:(point.x-drag.start.x)/240;
  applyDistribution(side,editDistribution(drag.values,kind,index,delta));
 });
 const finish=event=>{
  if(!distributionDrag||distributionDrag.control!==control||distributionDrag.pointerId!==event.pointerId)return;
  distributionDrag=null;
  if(control.hasPointerCapture(event.pointerId))control.releasePointerCapture(event.pointerId);
  const bounds=document.querySelector('.stage').getBoundingClientRect();
  if(event.pointerType==='touch'||event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)resumeAfterHover();
 };
 control.addEventListener('pointerup',finish);control.addEventListener('pointercancel',finish);control.addEventListener('lostpointercapture',finish);
 control.addEventListener('keydown',event=>{
  const negative=kind==='divider'?'ArrowUp':'ArrowLeft',positive=kind==='divider'?'ArrowDown':'ArrowRight';
  if(window.ramnetCompactInteractions.matches||event.code!==negative&&event.code!==positive)return;
  event.preventDefault();event.stopPropagation();
  playing=false;
  applyDistribution(side,editDistribution(model(progress)[side],kind,index,(event.code===positive?1:-1)*(event.shiftKey ? .05 : .01)));
 });
}
function layoutScene(){
 const {N,T,gap}=params,available=640,labelGap=8;
 const sceneHeight=1000/params.aspectRatio,labelHeight=24*params.fontScale;
 const verticalBudget=sceneHeight-158-3*labelHeight;
 const columnGap=Math.min(gap,available/(T*2)),rowGap=Math.min(gap,editorHeight/(N*2),verticalBudget/(N*2));
 // One square size fits the trace, both distributions, and the token/score rows.
 const cell=Math.min(33,(available-(T-1)*columnGap)/T,(editorHeight-(N-1)*rowGap)/N,(verticalBudget-(N-1)*rowGap)/(N+2)),pitch=cell+columnGap;
 const compactTop=44+cell+2*labelHeight,compactBottom=114+cell+labelHeight;
 const distHeight=Math.min(editorHeight,sceneHeight-compactTop-compactBottom),spareHeight=sceneHeight-compactTop-compactBottom-distHeight;
 const distY=compactTop+Math.min(161-compactTop,spareHeight*.5);
 const row=cell,rowPitch=row+rowGap;
 const gridWidth=T*cell+(T-1)*columnGap,gridHeight=N*row+(N-1)*rowGap;
 const x=(1000-gridWidth)/2,y=distY+(distHeight-gridHeight)/2,left=x-96,right=x+gridWidth+64;
 const tokenY=y-Math.min(110,cell+28+labelHeight+spareHeight*.25),responseY=y+gridHeight+Math.min(60,48+spareHeight*.15);
 geometry={cell,row,pitch,rowPitch,x,y,left,right,tokenY,responseY,gridWidth,gridHeight,distHeight};
 const svg=$('scene');svg.setAttribute('viewBox',`0 0 1000 ${sceneHeight}`);svg.replaceChildren();
 const defs=element('defs',{},svg),arrow=element('marker',{id:'axis-arrow',viewBox:'0 0 6 6',refX:5,refY:3,markerWidth:5,markerHeight:5,orient:'auto'},defs);
 element('path',{d:'M 0 0 L 6 3 L 0 6 Z',fill:'#899780'},arrow);
 const guide=element('g',{},svg);
 label(guide,x+gridWidth/2,tokenY-labelGap,'tokens','annotation','middle','bottom');
 label(guide,left+(cell-53)/2,distY-labelGap,'write dist','annotation','middle','bottom');
 label(guide,x+gridWidth/2,y-labelGap,'write trace','annotation','middle','bottom');
 path(guide,`M ${x-12} ${y} V ${y+gridHeight}`,'#98a38f',1.2,{'marker-end':'url(#axis-arrow)'});
 const slotLabel=label(guide,x-20,y+gridHeight/2,'slot','axis-label','middle','bottom');
 slotLabel.setAttribute('transform',`rotate(-90 ${x-20} ${y+gridHeight/2})`);
 path(guide,`M ${x} ${y+gridHeight+18} H ${x+gridWidth}`,'#98a38f',1.2,{'marker-end':'url(#axis-arrow)'});
 label(guide,x+gridWidth+labelGap,y+gridHeight+18,'time','axis-label','start','center');
 const matrix=element('g',{},svg),tokens=element('g',{},svg),writeGroup=element('g',{},svg);
 const readGroup=element('g',{},svg),responseGroup=element('g',{},svg),overlay=element('g',{'pointer-events':'none'},svg);
 nodes={tokens:[],left:[],right:[],cells:[],responses:[],bars:[],readGroup,responseGroup,overlay};
 label(readGroup,right+43,distY-labelGap,'read dist','annotation','middle','bottom');
 const scoreLabel=label(responseGroup,x+gridWidth/2,responseY+cell+labelGap,'attn. score','annotation','middle','top');
 for(let i=0;i<N;i++){
  nodes.left.push(rect(writeGroup,left,y+i*rowPitch,cell,cell,diagram.rgba(diagram.colors.red,diagram.alpha.surface),diagram.rgba(diagram.colors.red,diagram.alpha.border)));
  nodes.right.push(rect(readGroup,right,y+i*rowPitch,cell,cell,diagram.rgba(diagram.colors.green,diagram.alpha.surface),diagram.rgba(diagram.colors.green,diagram.alpha.border)));
 }
 nodes.writeEditor=createDistributionEditor(writeGroup,'write',left-53,distY,distHeight);
 nodes.readEditor=createDistributionEditor(readGroup,'read',right+64,distY,distHeight);
 for(let t=0;t<T;t++){
  const cx=x+t*pitch;
  nodes.tokens.push(rect(tokens,cx,tokenY,cell,cell,'#d3cfc4','#bdbdad'));
  const tokenIndex=label(tokens,cx+cell/2,tokenY+cell/2,String(t),'token-index');
  tokenIndex.setAttribute('dominant-baseline','central');tokenIndex.style.fontSize=Math.min(15*params.fontScale,cell*.7)+'px';
  const column=[];for(let i=0;i<N;i++)column.push(rect(matrix,cx,y+i*rowPitch,cell,row,'none','#bdbdad'));nodes.cells.push(column);
  const slot=rect(responseGroup,cx,responseY,cell,cell,diagram.rgba(diagram.colors.green,diagram.alpha.surface),diagram.rgba(diagram.colors.green,diagram.alpha.border));nodes.responses.push(slot);
  nodes.bars.push(rect(responseGroup,cx,responseY-5,cell,0,diagram.colors.green));
  const hit=rect(svg,cx,tokenY-8,cell,responseY+cell-tokenY+16,'transparent');hit.style.cursor='crosshair';hit.setAttribute('class','column-hit');
  hit.addEventListener('pointerenter',()=>{hovered=t;render()});hit.addEventListener('pointerleave',()=>{hovered=-1;render()});
 }
 nodes.highlights=element('g',{class:'score-highlights'},overlay);
 nodes.highlightFrames=Array.from({length:T},()=>{
  const frame=rect(nodes.highlights,x,tokenY-5,cell,responseY+cell-tokenY+10,'none',diagram.colors.green);
  frame.setAttribute('stroke-width',1.8);return frame;
 });
 nodes.focus=rect(overlay,x-3,tokenY-5,cell+6,y+gridHeight-tokenY+10,'none',diagram.colors.red);
 nodes.writeCopy=element('g',{class:'write-copy'},overlay);
 nodes.copyCells=nodes.left.map(cell=>{const copy=cell.cloneNode(false);nodes.writeCopy.append(copy);return copy});
 nodes.inspect=element('g',{},overlay);
 const capeControl=element('g',{id:'cape',class:'cape-control',role:'switch',tabindex:0,'aria-label':'CAPE','aria-checked':'false'},svg);
 element('title',{},capeControl).textContent='Toggle CAPE; the selection is retained until the next round';
 const scoreBox=scoreLabel.getBBox(),capeY=Math.max(distY+distHeight,scoreBox.y+scoreBox.height)+Math.min(48,22+spareHeight*.3);
 geometry.capeY=capeY;
 const capeLabel=label(capeControl,0,capeY,'CAPE','cape-label','start','center'),capeLabelBox=capeLabel.getBBox();
 const capeWidth=220,capeHeight=16,capeGap=14,capeLeft=(1000-capeLabelBox.width-capeGap-capeWidth)/2,capeX=capeLeft+capeLabelBox.width+capeGap;
 capeLabel.setAttribute('x',capeLeft-capeLabelBox.x);
 const capeHitHeight=window.ramnetCompactInteractions.matches?120:40;
 nodes.capeHit=rect(capeControl,capeLeft-10,capeY-capeHitHeight/2,capeLabelBox.width+capeGap+capeWidth+20,capeHitHeight,'transparent');nodes.capeHit.setAttribute('class','cape-hit');
 nodes.capeTrack=element('rect',{x:capeX,y:capeY-capeHeight/2,width:capeWidth,height:capeHeight,rx:capeHeight/2,fill:'#b0b7a7'},capeControl);
 nodes.capeThumb=element('circle',{cx:capeX+capeHeight/2,cy:capeY,r:6,fill:'#e8e2d3'},capeControl);
 geometry.capeStart=capeX+capeHeight/2;geometry.capeTravel=capeWidth-capeHeight;
 capeControl.addEventListener('click',toggleCape);
 capeControl.addEventListener('keydown',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();toggleCape()}});
}
let layoutKey='';
function render(){
 const key=[params.N,params.T,params.gap,params.cellRadius,params.fontScale,params.aspectRatio].join('/');
 if(key!==layoutKey){layoutKey=key;hovered=-1;layoutScene()}
 const m=model(progress),g=geometry,{N,T}=params;
 renderDistributionEditor(nodes.writeEditor,m.write);renderDistributionEditor(nodes.readEditor,m.read);
 const peak=Math.max(...m.write,...m.read,.001),strength=v=>Math.pow(clamp(v/peak),.72);
 const complete=Math.floor(m.writeProgress),fraction=m.writeProgress-complete;
 for(let i=0;i<N;i++){
  nodes.left[i].setAttribute('fill',color('red',.08+.92*strength(m.write[i])));
  nodes.right[i].setAttribute('fill',color('green',.08+.92*strength(m.read[i])));
 }
 const responseScale=Math.max(...m.response,.00001);
 for(let t=0;t<T;t++){
  const reveal=t<complete?1:0;
  nodes.tokens[t].setAttribute('fill',t===complete&&complete<T?'#a4af99':t<complete?'#c2c8b8':'#d3cfc4');
  for(let i=0;i<N;i++)nodes.cells[t][i].setAttribute('fill',color('red',reveal*(.04+.96*strength(m.columns[t][i]))));
  const a=m.response[t]/responseScale;
  nodes.responses[t].setAttribute('fill',color('green',.06+.94*a));
  const barHeight=2+18*a;nodes.bars[t].setAttribute('height',barHeight);nodes.bars[t].setAttribute('y',g.responseY-8-barHeight);
 }
 nodes.readGroup.setAttribute('opacity',m.readAlpha);nodes.responseGroup.setAttribute('opacity',m.responseAlpha);
 const topScore=Math.max(...m.response);
 const framePadding=Math.min(3,Math.max(0,(g.pitch-g.cell-2)/2));
 nodes.highlights.setAttribute('opacity',m.writeProgress>=T?.8*m.cape*m.responseAlpha:0);
 nodes.highlightFrames.forEach((frame,i)=>{
  frame.setAttribute('display',Math.abs(m.response[i]-topScore)<=1e-9?'inline':'none');
  frame.setAttribute('x',g.x+i*g.pitch-framePadding);
  frame.setAttribute('width',g.cell+2*framePadding);
 });
 const writing=m.writeProgress<T;
 nodes.focus.setAttribute('opacity',writing?1:0);nodes.focus.setAttribute('x',g.x+complete*g.pitch-3);
 nodes.writeCopy.setAttribute('display',writing?'inline':'none');
 if(writing){
  const travel=ramp(fraction,0,.88),copyX=lerp(g.left,g.x+complete*g.pitch,travel);
  const copied=shift(m.write,m.cape*complete*travel);
  nodes.copyCells.forEach((cell,i)=>{
   cell.setAttribute('x',copyX);
   cell.setAttribute('fill',color('red',lerp(.08+.92*strength(copied[i]),.04+.96*strength(copied[i]),travel)));
   cell.setAttribute('stroke',travel<1?diagram.rgba(diagram.colors.red,diagram.alpha.border):'#bdbdad');
  });
 }
 nodes.inspect.replaceChildren();
 if(hovered>=0&&hovered<Math.ceil(m.writeProgress)&&m.readAlpha>.9){
  const cx=g.x+hovered*g.pitch+g.cell/2;
  const frame=rect(nodes.inspect,cx-g.cell/2-3,g.tokenY-6,g.cell+6,g.responseY+g.cell-g.tokenY+12,'none',diagram.colors.green);frame.setAttribute('stroke-width',1.6);
  const shiftAmount=m.cape*hovered,whole=Math.floor(shiftAmount),shiftFraction=shiftAmount-whole;
  // Show the strongest source-to-slot routes, including fractional CAPE transitions.
  const writeLinks=m.write.flatMap((weight,from)=>[
   {from,to:mod(from-whole,N),value:weight*(1-shiftFraction)},
   {from,to:mod(from-whole-1,N),value:weight*shiftFraction}
  ]).filter(link=>link.value>0).sort((a,b)=>b.value-a.value).slice(0,4);
  for(const link of writeLinks){
   const startX=g.left+g.cell+3,endX=cx-g.cell/2,startY=g.y+link.from*g.rowPitch+g.row/2,endY=g.y+link.to*g.rowPitch+g.row/2;
   const distance=endX-startX,relative=link.value/writeLinks[0].value;
   path(nodes.inspect,`M ${startX} ${startY} C ${startX+distance*.4} ${startY}, ${endX-distance*.4} ${endY}, ${endX} ${endY}`,diagram.colors.red,2.5+4.5*relative,{opacity:.5+.4*relative,'stroke-linecap':'round',class:'write-link'});
  }
  const readLinks=m.read.map((weight,slot)=>({slot,value:weight*m.columns[hovered][slot]})).filter(link=>link.value>0).sort((a,b)=>b.value-a.value).slice(0,4);
  for(const link of readLinks){
   const relative=link.value/readLinks[0].value;
   path(nodes.inspect,`M ${g.right-4} ${g.y+link.slot*g.rowPitch+g.row/2} H ${cx+g.cell/2}`,diagram.colors.green,2.5+4.5*relative,{opacity:.5+.4*relative,'stroke-linecap':'round',class:'read-link'});
  }
 }
 const stageIndex=stages.findIndex(s=>progress<s.end),index=stageIndex<0?stages.length-1:stageIndex;
 $('cape').setAttribute('aria-checked',String(m.cape>0));
 nodes.capeHit.setAttribute('rx',params.panelRadius);
 nodes.capeTrack.setAttribute('fill',diagram.rgba(colors.green,lerp(diagram.alpha.low,diagram.alpha.strong,m.cape)));
 nodes.capeThumb.setAttribute('cx',g.capeStart+g.capeTravel*m.cape);
}
function seek(value){progress=clamp(value);playing=false;render()}
function togglePlay(){if(progress>=1){progress=0;beginRound()}playing=!playing;render()}
function toggleCape(){
 const from=model(progress).cape,to=capeTransition?1-capeTransition.to:from>0?0:1;
 capeOverride=from;
 capeTransition={from,to,elapsed:0,duration:params.capeDuration};
 previous=0;render();
}
function pauseForHover(event){
 if(window.ramnetCompactInteractions.matches||event.pointerType==='touch')return;
 hoverPaused=true;
 if(progress<stages[1].end)progress=stages[1].end-Number.EPSILON;
 previous=0;render();
}
function resumeAfterHover(){
 if(!hoverPaused||distributionDrag)return;
 if(pendingAdjustment)restartEditedAdjustment();
 hoverPaused=false;hovered=-1;playing=true;previous=0;render();
}
function frame(now){
 const dt=previous?Math.min((now-previous)/1000,.1):0;previous=now;
 if(!document.hidden){
  let changed=false;
  if(capeTransition&&!distributionDrag){
   capeTransition.elapsed+=dt*params.speed;
   capeOverride=lerp(capeTransition.from,capeTransition.to,smooth(capeTransition.elapsed/capeTransition.duration));
   if(capeTransition.elapsed>=capeTransition.duration){capeOverride=capeTransition.to;capeTransition=null}
   changed=true;
  }
  if(playing&&!hoverPaused&&!distributionDrag){
   progress+=dt*params.speed/params.duration;
   if(progress>=1){if(params.loop){progress%=1;beginRound()}else{progress=1;playing=false}}
   changed=true;
  }
  if(changed)render();
 }
 requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>previous=0);
window.ramnetCompactInteractions.addEventListener('change',()=>{
 if(distributionDrag){const {control,pointerId}=distributionDrag;distributionDrag=null;if(control.hasPointerCapture(pointerId))control.releasePointerCapture(pointerId);}
 document.querySelectorAll('.dist-editor [role="slider"]').forEach(element=>element.setAttribute('tabindex',window.ramnetCompactInteractions.matches?-1:0));
 if(nodes?.capeHit){const height=window.ramnetCompactInteractions.matches?120:40;nodes.capeHit.setAttribute('y',geometry.capeY-height/2);nodes.capeHit.setAttribute('height',height)}
 resumeAfterHover();
});
document.querySelector('.stage').addEventListener('pointerenter',pauseForHover);
document.querySelector('.stage').addEventListener('pointerleave',resumeAfterHover);
document.addEventListener('keydown',event=>{
 if(event.target.closest('input,select,button,summary,a,[role="switch"]'))return;
 if(event.code==='Space'){event.preventDefault();togglePlay()}
 else if(event.code==='ArrowLeft'||event.code==='ArrowRight'){event.preventDefault();seek(progress+(event.code==='ArrowRight'?1:-1)/params.duration/10)}
});
beginRound();render();scope.onAutoplayStart?.(()=>{progress=0;playing=true;hoverPaused=false;previous=0;beginRound();render();});requestAnimationFrame(frame);
};
if (document.body.classList.contains('exhibit-cape')) window.RamnetAnimations.cape({document, requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window)});
