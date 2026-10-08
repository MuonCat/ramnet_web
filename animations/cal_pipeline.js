window.RamnetAnimations ??= {};
window.RamnetAnimations.cal_pipeline = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame, translateText} = scope;
const palette=window.RamnetPalette;
'use strict';
const diagram=window.ramnetDiagramTheme;
// Reference: cuda_impl.py::gather_segment, ram_attn_topk_addr.cu,
// ram_attn_segment_parallel.cu. Worker slots visualize CUDA scheduling;
// the kernel itself assigns a segment to each warp, not a persistent queue.
const $=id=>document.getElementById(id);
const cfg={T:32,u:3,k:4,m:4,duration:38,projectionTime:1,mergeTime:2,splitTime:1,flattenTime:2,sortTime:6,segmentTime:1,lengthTime:3,valuesTime:1.5,executeTime:15,finishTime:0.5,gap:8,segmentGap:24,radius:6,panelRadius:18,space:20,trail:0.5,write:diagram.colors.red,read:diagram.colors.green,value:diagram.colors.orange,output:diagram.colors.sky,state:diagram.colors.sky,mass:diagram.colors.indigo,segment:diagram.colors.purple};
const colors={ink:palette.neutral(0),muted:palette.neutral(6),line:palette.neutral(11),paper:'transparent',token:palette.neutral(7),tokenInk:palette.neutral(5)};
const canvas=$('scene'),ctx=canvas.getContext('2d');
let data,stages=[],actionGroups=[],totalWeight=0,playhead=0,lastFrame=0,hits=[],hover=null,pointer=null,playing=true;
const stageTimeline=new StageTimeline($('stage-timeline'),time=>{playhead=time;setPlaying(false);hideTooltip();draw();});
const view={width:1,height:1,scale:1};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,p)=>a+(b-a)*p;
const ease=p=>{p=clamp(p);return p*p*(3-2*p);};
const phase=(p,a,b)=>ease((p-a)/(b-a));
const rgba=(hex,a)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${n>>8&255},${n&255},${clamp(a)})`;};
const bits=(a,n=cfg.u)=>a.toString(2).padStart(2*n,'0');
const lerpBox=(a,b,p)=>({x:mix(a.x,b.x,p),y:mix(a.y,b.y,p),w:mix(a.w,b.w,p),h:mix(a.h,b.h,p)});
function fade(a,fn){if(a<=0)return;ctx.save();ctx.globalAlpha*=clamp(a);fn();ctx.restore();}
function box(x,y,w,h,fill,stroke,r=cfg.radius){ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(r,w/2,h/2));if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.4;ctx.stroke();}}
function text(s,x,y,c=colors.muted,size=12,align='center',serif=false){ctx.fillStyle=diagram.text(c);ctx.font=`${serif?'italic 600 ':'400 '}${size}px ${serif?'Georgia':'Consolas, monospace'}`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(translateText(s),x,y);}
function line(x,y,xx,yy,c=colors.line,width=1.5){ctx.beginPath();ctx.lineCap='round';ctx.lineJoin='round';ctx.moveTo(x,y);ctx.lineTo(xx,yy);ctx.strokeStyle=c;ctx.lineWidth=width;ctx.stroke();}
function arrow(x,y,xx,yy,c,p=1){xx=mix(x,xx,p);yy=mix(y,yy,p);line(x,y,xx,yy,c);const a=Math.atan2(yy-y,xx-x),r=4;line(xx,yy,xx-r*Math.cos(a-.5),yy-r*Math.sin(a-.5),c);line(xx,yy,xx-r*Math.cos(a+.5),yy-r*Math.sin(a+.5),c);}
function flow(x,y,xx,yy,c,p,strength=1,payload='dot',bend=mix(y,yy,.5)){ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x,bend,xx,bend,xx,yy);ctx.strokeStyle=rgba(c,.55+cfg.trail*.35);ctx.lineWidth=.8+strength;ctx.stroke();const angle=yy===bend?Math.atan2(yy-y,xx-x):Math.atan2(yy-bend,0);line(xx,yy,xx-4*Math.cos(angle-.5),yy-4*Math.sin(angle-.5),rgba(c,.9));line(xx,yy,xx-4*Math.cos(angle+.5),yy-4*Math.sin(angle+.5),rgba(c,.9));const q=clamp(p),v=1-q,py=v*v*v*y+3*v*v*q*bend+3*v*q*q*bend+q*q*q*yy,px=v*v*v*x+3*v*v*q*x+3*v*q*q*xx+q*q*q*xx;if(payload==='vector')box(px-3,py-9,6,18,rgba(c,.7),c,2);else if(payload==='scalar'){const size=6+strength*4;box(px-size/2,py-size/2,size,size,rgba(c,.2+strength*.7),c,1.5);}else{ctx.beginPath();ctx.arc(px,py,3.4,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();}}
function buildData(){
 const rand=Math.random,vectors={w:[],r:[]},history={w:[],r:[]},events=[],values=[];
 for(let t=0;t<cfg.T;t++)values.push(Array.from({length:5},()=>.12+rand()*.82));
 for(const type of ['w','r'])for(let t=0;t<cfg.T;t++){
  const factors=Array.from({length:cfg.u},(_,d)=>{const v=Array.from({length:4},(_,j)=>Math.exp((rand()-.5)*2.3+(j===(d%2)?1.6:0))),sum=v.reduce((a,b)=>a+b,0);return v.map(x=>x/sum);});
  vectors[type].push(factors);let candidates=[{addr:0,weight:1}],steps=[];
  for(let d=0;d<cfg.u;d++){
   candidates=candidates.flatMap(a=>factors[d].map((w,j)=>({addr:a.addr+j*4**d,weight:a.weight*w}))).sort((a,b)=>b.weight-a.weight||a.addr-b.addr).slice(0,cfg.k);
   steps.push(candidates.map(a=>({...a})));
  }
  history[type].push(steps);const sum=candidates.reduce((a,b)=>a+b.weight,0);
  candidates.forEach((e,rank)=>events.push({...e,weight:e.weight/sum,type,t,rank,id:t*cfg.k*2+(type==='w'?0:cfg.k)+rank}));
 }
 events.sort((a,b)=>a.id-b.id);const sorted=events.slice().sort((a,b)=>a.addr-b.addr||a.id-b.id),segments=[];
 for(const e of sorted){let seg=segments[segments.length-1];if(!seg||seg.addr!==e.addr){seg={addr:e.addr,events:[]};segments.push(seg);}seg.events.push(e);e.segment=seg;}
 const ordered=segments.slice().sort((a,b)=>b.events.length-a.events.length||a.addr-b.addr),free=Array(cfg.m).fill(0),jobs=[];
 for(const seg of ordered){let lane=free.indexOf(Math.min(...free)),start=free[lane];const job={seg,lane,start,end:start+.8+seg.events.length};jobs.push(job);seg.job=job;free[lane]=job.end;}
 // The demonstration uses gamma=0, zero initial mass/state, and normalized Top-K weights.
 const completed=[];
 for(const job of jobs){let state=Array(5).fill(0),mass=0;job.seg.events.forEach((e,i)=>{const before=state.slice();if(e.type==='w'){const alpha=1-e.weight;mass=alpha*mass+e.weight;const gain=e.weight/(mass+1e-8);state=state.map((v,j)=>v+gain*(values[e.t][j]-v));}const contribution=e.type==='r'?state.map(x=>x*e.weight):null;const op={event:e,job,start:job.start+.8+i,end:job.start+1.8+i,before,after:state.slice(),contribution};completed.push(op);e.op=op;});}
 completed.sort((a,b)=>a.end-b.end||a.event.id-b.event.id);
 const sortSteps=[],prefix=[];let sortSpan=0;
 for(const [i,event] of events.entries()){let index=prefix.length;while(index>0&&prefix[index-1].addr>event.addr)index--;const duration=i<8?4:1;sortSteps.push({event,index,before:prefix.slice(),start:sortSpan,duration});prefix.splice(index,0,event);sortSpan+=duration;}
 data={vectors,history,events,sorted,segments,ordered,jobs,ops:completed,values,sortSteps,sortSpan,span:Math.max(...free),maxWeight:Math.max(...events.map(e=>e.weight))};
 layoutData();buildStages();
}
function randomizeData(){hideTooltip();buildData();resize();}
function layoutData(){
 const W=Math.max(2000,cfg.T*(Math.max(45,cfg.u*10+10)+cfg.gap)+100),pitch=(W-130)/cfg.T,cw=Math.min(44,pitch-cfg.gap),ch=cw;
 const vectorW=Math.min(18,cw*.45),vectorH=cfg.u*31+(cfg.u-1)*cfg.gap,matrixY=Math.max(320,155+vectorH+45),matrixBottom=matrixY+2*cfg.k*(cw+cfg.gap)-cfg.gap,rY=matrixBottom+48;
 const laneTop=310,laneH=76,laneStep=laneH+cfg.gap+10,outputY=laneTop+(cfg.m-1)*laneStep+laneH+70;
 const H=Math.max(1000,rY+vectorH+50,outputY+245),queueY=H-100,sortY=queueY-120-cfg.segmentGap;
 const matrix=new Map(),flat=new Map(),sorted=new Map(),segmented=new Map(),ordered=new Map();
 for(const e of data.events)matrix.set(e.id,{x:tokenColumnX(e.t),y:matrixY+(e.type==='w'?e.rank:cfg.k+e.rank)*(cw+cfg.gap),w:cw,h:ch});
 function tokenColumnX(t){return 65+(t+.5)*pitch-cw/2;}
 const chainScale=Math.min(1,(W-130)/(data.events.length*44+(data.events.length-1)*cfg.gap+(data.segments.length-1)*cfg.segmentGap));
 function pack(list,y,map,grouped){let x=65;for(const [si,seg] of list.entries()){
   if(grouped&&si)x+=cfg.segmentGap*chainScale;
   for(const e of seg.events){map.set(e.id,{x,y,w:44*chainScale,h:44*chainScale});x+=(44+cfg.gap)*chainScale;}
  }
 }
 pack([{events:data.events}],matrixY+(matrixBottom-matrixY)/2,flat,false);pack([{events:data.sorted}],sortY,sorted,false);pack(data.segments,sortY,segmented,true);pack(data.ordered,queueY,ordered,true);
 data.geo={W,H,pitch,cw,ch,vectorW,vectorH,matrixY,matrixBottom,rY,laneTop,laneH,laneStep,outputY,queueY,sortY,matrix,flat,sorted,segmented,ordered};
}
function buildStages(){
 stages=[{key:'project',name:'project r',weight:cfg.projectionTime},{key:'lower_r',name:'project w',weight:cfg.projectionTime},{key:'split',name:'address decode',weight:cfg.splitTime}];
 for(let d=0;d<cfg.u;d++)stages.push({key:'merge',digit:d,name:'address decode',weight:cfg.mergeTime});
 stages.push({key:'flatten',name:'group segments',weight:cfg.flattenTime},{key:'sort',name:'group segments',weight:cfg.sortTime},{key:'segment',name:'group segments',weight:cfg.segmentTime},{key:'length',name:'sort segments',weight:cfg.lengthTime},{key:'values',name:'parallel cross segments',weight:cfg.valuesTime},{key:'execute',name:'parallel cross segments',weight:cfg.executeTime},{key:'finish',name:'parallel cross segments',weight:cfg.finishTime});
 totalWeight=stages.reduce((sum,s)=>{s.start=sum;return sum+s.weight;},0);
 cfg.duration=Number(totalWeight.toFixed(6));
 actionGroups=[];
 stages.forEach((s,i)=>{if(actionGroups.at(-1)?.name!==s.name)actionGroups.push({name:s.name,first:i,weight:0});s.group=actionGroups.length-1;actionGroups[s.group].weight+=s.weight;});

 const labels=['Project r','Project w','Decode address','Group events','Sort segments','Parallel exec.'];
 stageTimeline.setStages(actionGroups.map((group,i)=>({label:labels[i],description:group.name,duration:group.weight/totalWeight*cfg.duration})));
}
function atTime(){const time=clamp(playhead/cfg.duration)*totalWeight;let i=stages.findIndex(s=>time<s.start+s.weight);if(i<0)i=stages.length-1;return {i,s:stages[i],p:clamp((time-stages[i].start)/stages[i].weight)};}
function tokenX(t){return 65+(t+.5)*data.geo.pitch;}
function tokens(){text('x',35,76,colors.tokenInk,20,'center',true);for(let t=0;t<cfg.T;t++){const x=tokenX(t),w=Math.min(33,data.geo.cw);box(x-w/2,60,w,w,rgba(colors.token,.08),rgba(colors.token,.5));text(t,x,107,colors.tokenInk,10);}}
function eventCard(e,g,alpha=1,labelBits=cfg.u,highlight=0){
 if(alpha<=0)return;const c=e.type==='w'?cfg.write:cfg.read,intensity=diagram.strength(e.weight/data.maxWeight,c);
 fade(alpha,()=>{const scale=Math.min(1,g.w/44);box(g.x,g.y,g.w,g.h,rgba(c,intensity),null,cfg.radius*scale);ctx.lineWidth=Math.max(.4,scale*(highlight?1.6:1.1));ctx.strokeStyle=rgba(c,.4+highlight*.5);ctx.stroke();const size=Math.min(11,g.w*.84/(labelBits*2*.61));text(bits(e.addr,labelBits),g.x+g.w/2,g.y+g.h/2,colors.ink,size);text(e.t,g.x+g.w-4*scale,g.y+g.h-5*scale,rgba(colors.ink,.65),8*scale,'right');});
 if(alpha>.7)hits.push({e,g});
}
function rawVectors(p,split=0,consumed=-1,consumeP=0,rMove=1,wAlpha=1,generating=null){
 const {vectorW,matrixY,matrixBottom,rY}=data.geo,blockH=31,gap=cfg.gap*split,height=cfg.u*blockH+(cfg.u-1)*gap;
 for(const type of ['w','r']){const c=type==='w'?cfg.write:cfg.read,base=type==='w'?155:mix(155,rY,rMove),alpha=p*(type==='w'?wAlpha:1);
  fade(alpha,()=>text(type,35,base+height/2,c,20,'center',true));
  for(let t=0;t<cfg.T;t++){const x=tokenX(t)-vectorW/2;fade(alpha,()=>{
   if(type===generating){const progress=type==='w'?wAlpha:p;fade(1-phase(progress,.8,1),()=>arrow(tokenX(t),119,tokenX(t),base-12,rgba(c,.28),progress));}
   fade(1-split,()=>vector(x,base,vectorW,height*(type==='w'?wAlpha:1),c));
   for(let d=0;d<cfg.u;d++){const active=d===consumed,used=d<consumed,a=used?0:active?1-consumeP:1,y=base+(type==='w'?cfg.u-1-d:d)*(blockH+gap);
    vector(x,y,vectorW,blockH,c,split*a);
    if(active){const target=type==='w'?matrixY-8:matrixBottom+8;fade(1-consumeP,()=>arrow(tokenX(t),type==='w'?y+blockH+4:y-4,tokenX(t),target,rgba(c,.4),consumeP));}
   }
  });}
 }
}
function mergeDraw(d,p){
 rawVectors(d===cfg.u-1?1-phase(p,.8,1):1,1,d,phase(p,.1,.8));
 for(const type of ['w','r'])for(let t=0;t<cfg.T;t++){
  const list=data.history[type][t][d],previous=d?data.history[type][t][d-1]:[],c=type==='w'?cfg.write:cfg.read;
  for(let rank=0;rank<list.length;rank++){
   const e=list[rank],id=t*cfg.k*2+(type==='w'?0:cfg.k)+rank,target=data.geo.matrix.get(id),q=phase(p,.16+rank*.035,.72+rank*.03);
   const yy=type==='w'?data.geo.matrixY-40:data.geo.matrixBottom+20,g={...target,y:mix(yy,target.y,q)};
   const current={...e,type,t,id,weight:d===cfg.u-1?mix(e.weight,data.events[id].weight,phase(p,.8,1)):e.weight};
   if(d===0){eventCard(current,g,q,1);}
   else{const prev=previous[rank];if(prev)eventCard({...prev,type,t,id},target,1-q,d);eventCard(current,target,q,d+1);}
   fade(Math.sin(q*Math.PI)*.65,()=>{box(target.x-2,target.y-2,target.w+4,target.h+4,null,rgba(c,.7),cfg.radius+2);});
  }
 }
}
function chain(map,list,alpha=1,grouped=false){
 fade(alpha,()=>{for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i];if(grouped&&a.addr!==b.addr)continue;const g=map.get(a.id),h=map.get(b.id);line(g.x+g.w,g.y+g.h/2,h.x,h.y+h.h/2,rgba(colors.ink,.15));}});
}
function segmentAddress(first,last){
 const width=last.x+last.w-first.x,size=Math.min(12,width/(cfg.u*2*.61));return {x:first.x,y:first.y-size-4,w:width,h:size+2};
}
function segmentFrame(segment,first,last,alpha=1,address=segmentAddress(first,last)){
 const pad=Math.min(6,(cfg.gap+cfg.segmentGap)*first.w/44*.22),left=Math.min(first.x,address.x)-pad,top=Math.min(first.y,address.y)-pad,right=Math.max(last.x+last.w,address.x+address.w)+pad,bottom=Math.max(first.y+first.h,address.y+address.h)+pad;
 fade(alpha,()=>{box(left,top,right-left,bottom-top,rgba(cfg.segment,diagram.alpha.surface),rgba(cfg.segment,diagram.alpha.border),Math.min(cfg.radius,pad));text(bits(segment.addr),address.x+address.w/2,address.y+address.h/2,colors.ink,Math.min(22,address.h-2,address.w/(cfg.u*2*.61)));});
 if(alpha>.7)hits.push({segment,g:{x:left,y:top,w:right-left,h:bottom-top}});
}
function movingEvents(from,to,p,list=data.events,stagger=.16){
 for(let i=0;i<list.length;i++){const e=list[i],delay=i/list.length*stagger,q=phase(p,delay,.82+delay),a=from.get(e.id),b=to.get(e.id),g=lerpBox(a,b,q);if(q>0&&q<1){if(a.y!==b.y)g.y-=Math.sin(q*Math.PI)*Math.min(75,Math.abs(a.x-b.x)*.13);if(cfg.trail)line(a.x+a.w/2,a.y+a.h/2,g.x+g.w/2,g.y+g.h/2,rgba(e.type==='w'?cfg.write:cfg.read,(1-q)*cfg.trail*.12));}eventCard(e,g);}
}
function descendingBox(a,b,p){
 return {...a,x:mix(a.x,b.x,phase(p,.22,.76)),y:a.y+(b.y-a.y)*.5*(phase(p,0,.22)+phase(p,.76,1))};
}
function insertionSort(p){
 const clock=clamp((p-.02)/.96)*data.sortSpan,index=data.sortSteps.findIndex(s=>clock<s.start+s.duration);
 if(index<0){chain(data.geo.sorted,data.sorted);for(const e of data.sorted)eventCard(e,data.geo.sorted.get(e.id));return;}
 const step=data.sortSteps[index],q=clamp((clock-step.start)/step.duration),first=data.geo.sorted.get(data.sorted[0].id),pitch=first.w*(44+cfg.gap)/44;
 for(let i=index+1;i<data.events.length;i++){const e=data.events[i];eventCard(e,data.geo.flat.get(e.id));}
 const shift=phase(q,.25,.65);
 step.before.forEach((e,i)=>eventCard(e,{...first,x:first.x+(i+(i>=step.index?shift:0))*pitch}));
 const src=data.geo.flat.get(step.event.id),dst={...first,x:first.x+step.index*pitch},g=descendingBox(src,dst,q),pulse=Math.sin(Math.PI*q),size=mix(g.w,Math.max(g.w,28),pulse);
 fade(pulse,()=>{box(dst.x-2,dst.y-3,dst.w+4,dst.h+6,null,rgba(colors.ink,.5),1);if(cfg.trail)line(src.x+src.w/2,src.y+src.h/2,g.x+g.w/2,g.y+g.h/2,rgba(colors.ink,cfg.trail*.3));});
 eventCard(step.event,{x:g.x+(g.w-size)/2,y:g.y+(g.h-size)/2,w:size,h:size},1,cfg.u,1);
}
function reorderSegments(p){
 const clock=clamp((p-.02)/.96)*data.ordered.length,index=Math.floor(clock),q=clock-index;
 for(let i=0;i<data.ordered.length;i++){if(i===index)continue;const map=i<index?data.geo.ordered:data.geo.segmented,segment=data.ordered[i];segmentFrame(segment,map.get(segment.events[0].id),map.get(segment.events.at(-1).id));for(const e of segment.events)eventCard(e,map.get(e.id));}
 if(index>=data.ordered.length)return;
 const segment=data.ordered[index];
 const first=segment.events[0],last=segment.events.at(-1);segmentFrame(segment,descendingBox(data.geo.segmented.get(first.id),data.geo.ordered.get(first.id),q),descendingBox(data.geo.segmented.get(last.id),data.geo.ordered.get(last.id),q));
 for(const e of segment.events){const a=data.geo.segmented.get(e.id),b=data.geo.ordered.get(e.id);eventCard(e,descendingBox(a,b,q),1,cfg.u,1);}
}
function vector(x,y,w,h,c,alpha=1){fade(alpha,()=>box(x,y,w,h,rgba(c,diagram.alpha.low),rgba(c,diagram.alpha.border)));}
function vectorRow(y,c,symbol,alpha=1,active=new Set()){fade(alpha,()=>{text(symbol,35,y+45,c,20,'center',true);for(let t=0;t<cfg.T;t++){const w=data.geo.vectorW;vector(tokenX(t)-w/2,y,w,90,c);if(active.has(t))box(tokenX(t)-w/2-2,y-2,w+4,94,null,rgba(c,.8),cfg.radius+2);}});}
function laneBox(lane){return {x:65,y:data.geo.laneTop+lane*data.geo.laneStep,w:data.geo.W-130,h:data.geo.laneH,addressW:Math.max(108,cfg.u*2*14+24)};}
function segmentBox(job,index){const g=laneBox(job.lane),maxLength=data.ordered[0].events.length,scale=Math.min(1,(g.w-g.addressW-210)/(maxLength*44+(maxLength-1)*cfg.gap)),size=44*scale;return {x:g.x+g.addressW+26+index*(44+cfg.gap)*scale,y:g.y+(g.h-size)/2,w:size,h:size};}
function slotGeometry(g){const x=g.x+g.w-96;return {x,y:g.y+9,w:84,h:58,s:{x:x+18,y:g.y+30,w:14,h:31},m:{x:x+47,y:g.y+36,w:20,h:20},unit:{x:x-60,y:g.y+24,w:28,h:28}};}
function threadUpdate({op,eg,progress,g,slot}){
 const e=op.event,write=e.type==='w',c=write?cfg.write:cfg.read,strength=clamp(e.weight/data.maxWeight),unit=slot.unit,s={x:slot.s.x+slot.s.w/2,y:slot.s.y+slot.s.h},m={x:slot.m.x+slot.m.w/2,y:slot.m.y+slot.m.h};
 const left={x:unit.x,y:unit.y+unit.h/2},right={x:unit.x+unit.w,y:left.y},top={x:unit.x+unit.w/2,y:unit.y},bottom={x:top.x,y:unit.y+unit.h};
 function signal(start,end,from,to,color,payload='dot',weight=1,bend=mix(from.y,to.y,.5)){fade(phase(progress,start,start+.05)*(1-phase(progress,end,Math.min(1,end+.12))),()=>flow(from.x,from.y,to.x,to.y,color,phase(progress,start,end),weight,payload,bend));}
 signal(.02,.4,{x:eg.x+eg.w/2,y:eg.y},left,c,'scalar',strength,g.y+6);
 signal(.02,.4,s,right,cfg.state,'vector',1,g.y+68);
 if(write){
  signal(.02,.4,{x:tokenX(e.t),y:240},top,cfg.value,'vector');
  signal(.02,.4,m,right,cfg.mass,'scalar',1,g.y+68);
  signal(.58,.94,right,s,cfg.state,'vector',1,g.y+72);
  signal(.58,.94,right,m,cfg.mass,'scalar',1,g.y+72);
 }else{
  signal(.58,.94,bottom,{x:tokenX(e.t),y:data.geo.outputY},cfg.output,'vector');
 }
 const readPulse=Math.sin(Math.PI*phase(progress,.02,.4)),writePulse=write?Math.sin(Math.PI*phase(progress,.58,1)):0;
 fade(Math.max(readPulse,writePulse),()=>{box(slot.s.x-3,slot.s.y-3,slot.s.w+6,slot.s.h+6,writePulse?rgba(cfg.state,.12+strength*.2):null,cfg.state,cfg.radius+2);if(write)box(slot.m.x-3,slot.m.y-3,slot.m.w+6,slot.m.h+6,writePulse?rgba(cfg.mass,.08+strength*.16):null,cfg.mass,Math.min(cfg.radius+1,4));});
 fade(Math.sin(Math.PI*phase(progress,.3,.68)),()=>box(unit.x,unit.y,unit.w,unit.h,rgba(c,.18),c,cfg.radius));
}
function outputAt(t){const out=Array.from({length:cfg.T},()=>Array(5).fill(0)),counts=Array(cfg.T).fill(0);for(const op of data.ops){if(op.end>t)break;if(op.contribution){op.contribution.forEach((v,j)=>out[op.event.t][j]+=v);counts[op.event.t]++;}}return {out,counts};}
function execution(p,intro=false,finish=false){
 const t=intro?-1:p*(data.span+.9),entry=intro?phase(p,.28,.8):1;
 const counts=t<0?Array(cfg.T).fill(0):outputAt(t).counts,writeActive=new Set(),readActive=new Set();
 const live=[];
 for(const seg of data.ordered){const a=t<seg.job.start?1:0;segmentFrame(seg,data.geo.ordered.get(seg.events[0].id),data.geo.ordered.get(seg.events.at(-1).id),a);for(const e of seg.events)eventCard(e,data.geo.ordered.get(e.id),a);}
 for(let lane=0;lane<cfg.m;lane++){const job=data.jobs.find(j=>j.lane===lane&&t>=j.start&&t<j.end),g=laneBox(lane),slot=slotGeometry(g);fade(entry,()=>{
   box(g.x,g.y,g.w,g.h,rgba(colors.ink,.014),rgba(colors.ink,.15),cfg.radius+5);text(`ω${lane}`,g.x-20,g.y+g.h/2,colors.muted,12);
   fade(job?1:.35,()=>{box(slot.unit.x,slot.unit.y,slot.unit.w,slot.unit.h,colors.paper,rgba(colors.ink,.5),cfg.radius);box(slot.x,slot.y,slot.w,slot.h,rgba(colors.ink,.025),rgba(colors.ink,.24),cfg.radius+2);text('s',slot.s.x+slot.s.w/2,g.y+21,cfg.state,17,'center',true);text('m',slot.m.x+slot.m.w/2,g.y+21,cfg.mass,17,'center',true);box(slot.s.x,slot.s.y,slot.s.w,slot.s.h,rgba(cfg.state,diagram.alpha.strong),cfg.state);box(slot.m.x,slot.m.y,slot.m.w,slot.m.h,rgba(cfg.mass,diagram.alpha.strong),cfg.mass,Math.min(cfg.radius,3));});
   if(!job){text(t>=0?'∅':'·',g.x+g.w/2,g.y+g.h/2,rgba(colors.ink,.25),22);return;}
   const local=t-job.start-.8,index=Math.floor(local),progress=local-index,op=local>=0?job.seg.events[index]?.op:null;
   const transfer=phase(t-job.start,0,.8);
   const cards=job.seg.events.map((e,j)=>{const dest=segmentBox(job,j);return local<0?lerpBox(data.geo.ordered.get(e.id),dest,transfer):dest;});
   const targetAddress={x:g.x+12,y:g.y+20,w:g.addressW,h:36},sourceAddress=segmentAddress(data.geo.ordered.get(job.seg.events[0].id),data.geo.ordered.get(job.seg.events.at(-1).id));
   segmentFrame(job.seg,cards[0],cards.at(-1),1,local<0?lerpBox(sourceAddress,targetAddress,transfer):targetAddress);
   job.seg.events.forEach((e,j)=>eventCard(e,cards[j],j<index?.23:1,cfg.u,j===index?1:0));
   if(op){const eg=segmentBox(job,index),scanX=eg.x+progress*(eg.w+cfg.gap*eg.w/44),c=op.event.type==='w'?cfg.write:cfg.read;line(scanX,g.y+9,scanX,g.y+g.h-9,c,2);line(scanX-3,g.y+9,scanX+3,g.y+9,c,2);line(scanX-3,g.y+g.h-9,scanX+3,g.y+g.h-9,c,2);live.push({op,eg,progress,g,slot});if(op.event.type==='w')writeActive.add(op.event.t);else readActive.add(op.event.t);}
  });
 }
 vectorRow(150,cfg.value,'v',intro?phase(p,.05,.6):1,writeActive);
 if(intro)fade(phase(p,.05,.4)*(1-phase(p,.7,1)),()=>{for(let i=0;i<cfg.T;i++)arrow(tokenX(i),119,tokenX(i),139,rgba(cfg.value,.4),phase(p,.05,.55));});
 vectorRow(data.geo.outputY,cfg.output,'o',entry,readActive);
 for(let i=0;i<cfg.T;i++)if(counts[i]){const w=data.geo.vectorW;box(tokenX(i)-w/2,data.geo.outputY+98,w*counts[i]/cfg.k,2,rgba(cfg.read,.7),null,1);}
 for(const update of live)threadUpdate(update);
 fade(entry,()=>text('Q',35,data.geo.queueY+4,colors.muted,19,'center',true));
 if(finish){for(let i=0;i<cfg.T;i++){const w=data.geo.vectorW;fade(phase(p,0,.3),()=>box(tokenX(i)-w/2-2,data.geo.outputY-2,w+4,94,null,rgba(cfg.output,.7)));}}
}
function draw(){
 if(!data)return;const dpr=Math.min(devicePixelRatio||1,3);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,view.width,view.height);
 const scale=view.scale,ox=(view.width-data.geo.W*scale)/2,oy=(view.height-data.geo.H*scale)/2;ctx.translate(ox,oy);ctx.scale(scale,scale);hits=[];
 const {s,p}=atTime();tokens();
 switch(s.key){
  case 'project':rawVectors(phase(p,0,.85),0,-1,0,0,0,'r');break;
  case 'lower_r':{const move=phase(p,.05,.9);rawVectors(1,0,-1,0,move,move,'w');break;}
  case 'split':rawVectors(1,phase(p,.05,.8));break;
  case 'merge':mergeDraw(s.digit,p);break;
  case 'flatten':chain(data.geo.flat,data.events,phase(p,.65,1));movingEvents(data.geo.matrix,data.geo.flat,p);break;
  case 'sort':insertionSort(p);break;
  case 'segment':{const q=phase(p,0,.82);for(const segment of data.segments){const first=segment.events[0],last=segment.events.at(-1);segmentFrame(segment,lerpBox(data.geo.sorted.get(first.id),data.geo.segmented.get(first.id),q),lerpBox(data.geo.sorted.get(last.id),data.geo.segmented.get(last.id),q),phase(p,.2,.95));}chain(data.geo.segmented,data.sorted,1,true);movingEvents(data.geo.sorted,data.geo.segmented,p,data.sorted,0);break;}
  case 'length':reorderSegments(p);break;
  case 'values':execution(p,true);break;
  case 'execute':execution(p);break;
  case 'finish':execution(1,false,true);break;
 }
 updateHover();
 if(hover)box(hover.g.x-2,hover.g.y-2,hover.g.w+4,hover.g.h+4,null,colors.ink,cfg.radius+2);
 updateUI();
}
function resize(){hideTooltip();const viewport=$('viewport');view.width=viewport.clientWidth;view.height=viewport.clientHeight;const dpr=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(view.width*dpr);canvas.height=Math.round(view.height*dpr);view.scale=Math.min((view.width-18)/data.geo.W,(view.height-12)/data.geo.H);draw();}
function updateUI(){stageTimeline.update(playhead);}
function setPlaying(value){playing=value;lastFrame=0;window.RamnetRuntime.setPlaybackIcon($('play'),playing);$('play').title=translateText(playing?'Pause (Space)':'Play (Space)');}
function seekAction(i){i=clamp(i,0,actionGroups.length-1);const s=stages[actionGroups[i].first];playhead=(s.start+Math.min(.08,s.weight*.025))/totalWeight*cfg.duration;setPlaying(false);hideTooltip();draw();}
function applyStyle(){document.documentElement.style.setProperty('--radius',cfg.panelRadius+'px');document.documentElement.style.setProperty('--space',cfg.space+'px');}
function hideTooltip(){pointer=null;hover=null;$('tooltip').style.display='none';}
function updateHover(){
 if(!pointer)return;
 const scale=view.scale,ox=(view.width-data.geo.W*scale)/2,oy=(view.height-data.geo.H*scale)/2,x=(pointer.x-ox)/scale,y=(pointer.y-oy)/scale;
 const hit=hits.findLast(h=>x>=h.g.x&&x<=h.g.x+h.g.w&&y>=h.g.y&&y<=h.g.y+h.g.h),tip=$('tooltip');
 hover=hit??null;
 if(!hit){tip.style.display='none';return;}
 tip.textContent=hit.e?`${translateText('slot')} ${bits(hit.e.addr)}\n${translateText(hit.e.type==='w'?'write':'read')} @ t = ${hit.e.t}\n${translateText('weight')} = ${hit.e.weight.toFixed(4)}`:`${translateText('slot')} ${bits(hit.segment.addr)}\n${translateText('event segment')}`;tip.style.display='block';tip.style.left=clamp(pointer.x+12,4,Math.max(4,view.width-tip.offsetWidth-6))+'px';tip.style.top=clamp(pointer.y+12,4,Math.max(4,view.height-tip.offsetHeight-6))+'px';
}
$('play').addEventListener('click',()=>{if(playhead>=cfg.duration){playhead=0;randomizeData();}setPlaying(!playing);});
$('restart').addEventListener('click',()=>{playhead=0;randomizeData();setPlaying(true);});
$('prev').addEventListener('click',()=>seekAction(atTime().s.group-1));$('next').addEventListener('click',()=>seekAction(atTime().s.group+1));
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer={x:(e.clientX-r.left)*view.width/r.width,y:(e.clientY-r.top)*view.height/r.height};updateHover();if(!playing)draw();});
canvas.addEventListener('pointerleave',()=>{hideTooltip();if(!playing)draw();});
document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,button'))return;if(e.code==='Space'){e.preventDefault();$('play').click();}else if(e.code==='ArrowRight'){e.preventDefault();seekAction(atTime().s.group+1);}else if(e.code==='ArrowLeft'){e.preventDefault();seekAction(atTime().s.group-1);}else if(e.code==='Escape'&&document.body.classList.contains('focus')){document.body.classList.remove('focus');resize();}});
new ResizeObserver(resize).observe($('viewport'));document.body.getRootNode().host?.addEventListener('ramnet:fit',resize);
document.addEventListener('visibilitychange',()=>lastFrame=0);
function tick(now){const dt=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(playing&&!document.hidden){playhead+=dt;if(playhead>=cfg.duration){playhead%=cfg.duration;randomizeData();}draw();}requestAnimationFrame(tick);}
buildData();scope.setCycleDuration?.(cfg.duration);applyStyle();setPlaying(true);resize();scope.onAutoplayStart?.(event=>{if(!event.detail?.resumeCurrent){$('restart').click();return;}event.detail.remainingMs=Math.max(0,(cfg.duration-playhead)*1000);setPlaying(true);hideTooltip();draw();});requestAnimationFrame(tick);
};
if (document.body.classList.contains('exhibit-cal_pipeline')) window.RamnetRuntime.mountStandalone('cal_pipeline');
