window.RamnetAnimations ??= {};
window.RamnetAnimations.ramnet_arch = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame} = scope;
'use strict';
const diagram=window.ramnetDiagramTheme;
const $=id=>document.getElementById(id), canvas=$('scene'), ctx=canvas.getContext('2d');
const W=1400,H=790,AX=435,AW=907;
const C={ink:'#30383f',muted:'#797f75',line:'#bebdaf',paper:'transparent',purple:diagram.colors.purple,gold:diagram.colors.gold,v:diagram.colors.gold,gsu:diagram.colors.green,slot:diagram.colors.sky,mass:diagram.colors.blue,token:'#acb3b9',tokenDone:'#818c96',tokenSpent:'#d3cfc4',red:diagram.colors.red,link:'#879482',archPaper:'#f7f8f3',frame:'#dce4d5',bg:'#f3f4ef',accent:'#547963',highlight:'#f6f0e3'};
const actions=[
 ['linear projection','token 向上投影为 gate、γ、v、q、k。',1.5],
 ['k · Product Softmax','k 拆成 U 个列向量；各因子概率相乘，快速扫描全部地址，输出完整 w。',3],
 ['w · topk','未入选的地址同时标红叉，实心元素淡出后留下空心虚线框。',1.5],
 ['w · CAPE','写入分布在 CAPE 大框内按时间步Loop平移，越界部分从另一端接回。',1.5],
 ['稀疏路由','保留的 w 上移进入 GSU，模块深浅随 w 改变。',1],
 ['广播 γ','γ 方格进入被选中的 GSU，模块深浅转为 η；底部输入随之消耗。',1],
 ['广播 v · 写入','v 穿过 GSU 写入 slot，slot 与 mass 的深浅随状态更新；记忆跨轮保留。',2],
 ['q · Product Softmax','q 经过同一 Product Softmax，产生完整读取分布 r。',3],
 ['r · topk','读取分布保留 topk，其余地址淡出后留下空心虚线框。',1.5],
 ['r · CAPE','读取分布在 CAPE 大框内施加与写入相同的时间位置平移。',1.5],
 ['读取 · 聚合','S 的副本穿过 r 衰减，沿曲线直接汇聚为一个列向量 o。',2],
 ['Norm / sigmoid','o 连续向右穿过 Norm；gate 同时向上穿过 sigmoid 图标。',1],
 ['gate · 合并','gate 沿水平直线追上向右移动的 o，合为一个列向量。',1],
 ['输出','合并后的列向量向右输出，省略 Linear 模块示意。',.5],
 ['token 前移','本 token 完成，方形 token 带向右前进一格，衔接下一轮。',1.5]
];
const stages=[
 ['01','linear projection',0,1,actions[0][1]],
 ['02',actions[1][0],1,2,actions[1][1]],
 ['03',actions[2][0],2,3,actions[2][1]],
 ['04',actions[3][0],3,4,actions[3][1]],
 ['05–07','GSU update',4,7,'w、γ、v 依次进入 GSU，并更新选中的 slot。'],
 ['08',actions[7][0],7,8,actions[7][1]],
 ['09',actions[8][0],8,9,actions[8][1]],
 ['10',actions[9][0],9,10,actions[9][1]],
 ['11–15','output',10,15,'读取选中的 slot，聚合、归一化并与 gate 合并输出，随后 token 前移。']
];

["Project", "Write address", "Write Top-K", "Write CAPE", "GSU", "Read address", "Read Top-K", "Read CAPE", "Read & output"].forEach((label,i)=>stages[i][1]=label);
["Project the token into gate, γ, v, q and k.", "Decode the key into write addresses.", "Retain the highest-weight write addresses.", "Shift write addresses by the token position.", "Update only the selected slots with w, γ and v.", "Decode the query into read addresses.", "Retain the highest-weight read addresses.", "Shift read addresses by the token position.", "Read selected slots, normalize, apply the output gate and advance the token."].forEach((description,i)=>stages[i][4]=description);
const defaults={U:5,dp:2,topK:4,temperature:.7,gamma:1,capeStep:1,initialMass:.8,speed:1,loop:true,pace:1,moduleFade:1.2,idleScale:.65,aspectRatio:2,zoom:1,archWidth:420,archOffsetY:37,routeRadius:22,connectorGap:8,upperModuleGap:26,subvecSpacing:32,memoryGap:40,gap:5,cellRadius:4,panelRadius:16,spacing:18,lineWidth:1.6,trail:1,fontScale:1,uiScale:1,writeColor:diagram.colors.red,readColor:diagram.colors.green,colors:{...C},durations:actions.map(a=>a[2])};
const tokenBeltLayout={step:56,size:34,center:870,right:1354};
let params=structuredClone(defaults),elapsed=0,playing=true,round=0,initialTime=2,lastTime=null,pan=0,memory=[],mass=[],data,toastTimer;
const stageTimeline=new StageTimeline($('stage-timeline'),time=>{playing=false;elapsed=time;updatePlayback();render();});
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),mix=(a,b,p)=>a+(b-a)*p,ease=p=>{p=clamp(p);return p*p*(3-2*p)},phase=(p,a,b)=>ease((p-a)/(b-a)),mod=(n,m)=>(n%m+m)%m;
const duration=i=>params.durations[i]*params.pace,total=()=>params.durations.reduce((a,b)=>a+b,0)*params.pace;
function locationAt(){let start=0;for(let i=0;i<actions.length;i++){const d=duration(i);if(elapsed<start+d||i===actions.length-1)return {i,p:clamp((elapsed-start)/d),start};start+=d;}}
function stageStart(i){return params.durations.slice(0,i).reduce((a,b)=>a+b,0)*params.pace;}
const stageForAction=i=>stages.findIndex(([, ,first,last])=>i>=first&&i<last),groupStart=i=>stageStart(stages[i][2]),groupDuration=i=>stageStart(stages[i][3])-groupStart(i);
function randomGenerator(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return (s+.5)/4294967296;};}
function randomSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function distribution(factors){return Array.from({length:params.dp**params.U},(_,j)=>factors.reduce((v,f,u)=>v*f[Math.floor(j/params.dp**u)%params.dp],1));}
function topIndices(values){return values.map((_,i)=>i).sort((a,b)=>values[b]-values[a]||a-b).slice(0,params.topK);}
function beginRound(){
 const rand=randomGenerator(randomSeed()),factors=Array.from({length:params.U},()=>Array.from({length:params.dp},()=>rand()*2-1));
 const softmax=a=>{const e=a.map(x=>Math.exp(x/params.temperature)),sum=e.reduce((s,x)=>s+x,0);return e.map(x=>x/sum);};
 const query=factors.map(f=>f.map(x=>x+(rand()-.5)*1.6)),kf=factors.map(softmax),qf=query.map(softmax),w=distribution(kf),r=distribution(qf),wk=topIndices(w),rk=topIndices(r),N=w.length;
 const kVisual=factors.flat().map(x=>clamp(.5+x*.3)),qVisual=query.flat().map(x=>clamp(.5+x*.3));
 const shift=mod((initialTime+round)*params.capeStep,N),dest=j=>mod(j-shift,N),v=Array.from({length:6},()=>.12+rand()*.88),vShade=.42+.53*rand(),gate=Array.from({length:6},()=>.25+rand()*.7);
 const updated=memory.map(x=>x.slice()),updatedMass=mass.slice(),eta=Array(N).fill(0);
 // Keep the sparse weights unnormalized, matching product addressing and GSU.
 for(const j of wk){const id=dest(j),weight=w[j],retention=(1-weight)/(1-weight+weight*Math.exp(params.gamma)),nextMass=retention*mass[id]+weight;eta[j]=weight/(nextMass+1e-4);updatedMass[id]=nextMass;updated[id]=memory[id].map((x,d)=>x+eta[j]*(v[d]-x));}
 const o=Array.from({length:6},(_,d)=>rk.reduce((sum,j)=>sum+r[j]*updated[dest(j)][d],0)),rms=Math.sqrt(o.reduce((sum,x)=>sum+x*x,0)/6+1e-8),norm=o.map(x=>x/rms),gated=norm.map((x,d)=>x*gate[d]);
 const output=gated.map((_,d)=>gated.reduce((s,x,j)=>s+x*(d===j?.72:.056),0));
 data={N,kf,qf,kVisual,qVisual,w,r,wk,rk,shift,v,vShade,gate,eta,updated,updatedMass,o,norm,gated,output,dest};
}
function resetSimulation(){round=0;initialTime=Math.ceil((tokenBeltLayout.right-tokenBeltLayout.center-tokenBeltLayout.size/2)/tokenBeltLayout.step)+1+randomSeed()%4;elapsed=0;pan=0;const rand=randomGenerator(randomSeed());memory=Array.from({length:params.dp**params.U},()=>{const level=.08+rand()*.84;return Array.from({length:6},()=>clamp(level+(rand()-.5)*.12));});mass=memory.map(()=>params.initialMass*(.4+1.2*rand()));beginRound();}
function nextRound(){memory=data.updated.map(x=>x.slice());mass=data.updatedMass.slice();round++;elapsed=0;beginRound();}
function alpha(a,fn){if(a<=0)return;ctx.save();ctx.globalAlpha*=clamp(a);fn();ctx.restore();}
function box(x,y,w,h,fill,stroke=null,r=params.cellRadius){ctx.beginPath();ctx.roundRect(x,y,Math.max(0,w),Math.max(0,h),Math.min(r,w/2,h/2));if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=params.lineWidth;ctx.stroke();}}
function label(text,x,y,color=C.ink,size=16,align='center',math=false){ctx.save();const transform=ctx.getTransform();ctx.translate(x,y);ctx.scale(transform.d/transform.a,1);ctx.fillStyle=diagram.text(color);ctx.font=`${math?'italic ':''}${color!==C.ink&&color!==C.muted?'600':'400'} ${size*params.fontScale}px ${math?'Georgia':'"Segoe UI", sans-serif'}`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(text,0,0);ctx.restore();}
function path(points,color=C.line,width=params.lineWidth,dashed=false){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[4,5]:[]);ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]);}
function curve(points,color=C.line){ctx.beginPath();ctx.moveTo(...points[0]);ctx.bezierCurveTo(...points[1],...points[2],...points[3]);ctx.strokeStyle=color;ctx.lineWidth=params.lineWidth;ctx.lineCap='round';ctx.stroke();}
function curvePoint(points,t){const s=1-t;return [0,1].map(d=>s*s*s*points[0][d]+3*s*s*t*points[1][d]+3*s*t*t*points[2][d]+t*t*t*points[3][d]);}
function trimmedCurve(points,color,startGap=0,endGap=params.connectorGap,startTarget=null,endTarget=null){
 const samples=Array.from({length:97},(_,n)=>curvePoint(points,n/96)),lengths=[0];
 for(let n=1;n<samples.length;n++)lengths.push(lengths[n-1]+Math.hypot(samples[n][0]-samples[n-1][0],samples[n][1]-samples[n-1][1]));
 let start=startGap,end=lengths.at(-1)-endGap;
 const distance=(point,target)=>Math.hypot(Math.max(0,Math.abs(point[0]-target.x)-target.halfWidth),Math.max(0,Math.abs(point[1]-target.y)-target.halfHeight));
 if(startTarget){const clearance=params.connectorGap+params.lineWidth/2+.5;start=end+1;for(let n=1;n<samples.length;n++){const after=distance(samples[n],startTarget);if(after<clearance)continue;const before=distance(samples[n-1],startTarget),q=before<clearance?(clearance-before)/(after-before):1;start=mix(lengths[n-1],lengths[n],q);break;}}
 if(endTarget){const clearance=params.connectorGap+params.lineWidth/2+.5;end=start-1;for(let n=samples.length-1;n>0;n--){const before=distance(samples[n-1],endTarget);if(before<clearance)continue;const after=distance(samples[n],endTarget),q=after<clearance?(clearance-before)/(after-before):0;end=mix(lengths[n-1],lengths[n],q);break;}}
 if(end<=start)return;
 const pointAt=distance=>{let n=1;while(lengths[n]<distance)n++;const q=(distance-lengths[n-1])/(lengths[n]-lengths[n-1]);return [mix(samples[n-1][0],samples[n][0],q),mix(samples[n-1][1],samples[n][1],q)];};
 ctx.beginPath();ctx.moveTo(...pointAt(start));for(let n=1;n<samples.length-1;n++)if(lengths[n]>start&&lengths[n]<end)ctx.lineTo(...samples[n]);ctx.lineTo(...pointAt(end));ctx.strokeStyle=color;ctx.lineWidth=params.lineWidth;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
}
function roundedRoute(vertices){
 const points=vertices.filter((p,i)=>i===0||p[0]!==vertices[i-1][0]||p[1]!==vertices[i-1][1]),shape=new Path2D(),samples=[points[0]];
 shape.moveTo(...points[0]);
 for(let j=1;j<points.length-1;j++){
  const prev=points[j-1],corner=points[j],next=points[j+1],before=Math.hypot(corner[0]-prev[0],corner[1]-prev[1]),after=Math.hypot(next[0]-corner[0],next[1]-corner[1]),r=Math.min(params.routeRadius,before/2,after/2);
  const start=corner.map((v,d)=>v+(prev[d]-v)*r/before),end=corner.map((v,d)=>v+(next[d]-v)*r/after);
  shape.lineTo(...start);shape.quadraticCurveTo(...corner,...end);samples.push(start);
  for(let k=1;k<=12;k++){const t=k/12,s=1-t;samples.push(start.map((v,d)=>s*s*v+2*s*t*corner[d]+t*t*end[d]));}
 }
 shape.lineTo(...points.at(-1));samples.push(points.at(-1));return {shape,points:samples};
}
function routeArrow(route,color){ctx.strokeStyle=color;ctx.lineWidth=params.lineWidth;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(route.shape);const [x,y]=route.points.at(-1),[a,b]=route.points.at(-2),angle=Math.atan2(y-b,x-a);path([[x-6*Math.cos(angle-.5),y-6*Math.sin(angle-.5)],[x,y],[x-6*Math.cos(angle+.5),y-6*Math.sin(angle+.5)]],color);}
function arrow(points,color=C.line,head=6){path(points,color);const [x,y]=points.at(-1),[a,b]=points.at(-2),angle=Math.atan2(y-b,x-a);path([[x-head*Math.cos(angle-.5),y-head*Math.sin(angle-.5)],[x,y],[x-head*Math.cos(angle+.5),y-head*Math.sin(angle+.5)]],color);}
function verticalLink(x,fromEdge,toEdge,color=C.link){const distance=Math.abs(toEdge-fromEdge),gap=Math.min(params.connectorGap,Math.max(3,(distance-5)/2)),direction=Math.sign(toEdge-fromEdge),start=fromEdge+direction*gap,end=toEdge-direction*gap;if(direction*(end-start)>0)arrow([[x,start],[x,end]],color,Math.min(6,Math.abs(end-start)*.6));}
function circleAspect(){const t=ctx.getTransform();return Math.hypot(t.c,t.d)/Math.hypot(t.a,t.b);}
function roundSymbol(x,y,draw){ctx.save();ctx.translate(x,y);ctx.scale(circleAspect(),1);draw();ctx.restore();}
function circle(x,y,r,fill,stroke){ctx.beginPath();ctx.ellipse(x,y,r*circleAspect(),r,0,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=params.lineWidth;ctx.stroke();}}
function sigmoidSymbol(x,y,r=10,lit=0){roundSymbol(x,y,()=>{alpha(lit,()=>circle(0,0,r+5,C.purple+'40',C.purple));circle(0,0,r,C.paper,C.purple);alpha(lit,()=>circle(0,0,r,C.purple+'70',C.purple));curve([[-.7*r,.4*r],[.4*r,.4*r],[-.4*r,-.4*r],[.7*r,-.4*r]],C.purple);});}
function dot(x,y,color,size=4){const r=size*params.trail;circle(x,y,r*3,color+'12');circle(x,y,r*1.7,color+'26');circle(x,y,r,color);circle(x-1,y-1,r*.3,C.highlight);}
function along(points,t,color,size=4,glowTrim=16){let lengths=[],sum=0;for(let j=1;j<points.length;j++){const n=Math.hypot(points[j][0]-points[j-1][0],points[j][1]-points[j-1][1]);lengths.push(n);sum+=n;}const glowLength=sum-glowTrim;if(t>0&&t<1&&glowLength>1){const glow=[points[0]];let covered=0;for(let j=0;j<lengths.length;j++){if(covered+lengths[j]>=glowLength){const q=(glowLength-covered)/lengths[j];glow.push([mix(points[j][0],points[j+1][0],q),mix(points[j][1],points[j+1][1],q)]);break;}covered+=lengths[j];glow.push(points[j+1]);}ctx.save();ctx.globalAlpha*=.58;ctx.shadowColor=color;ctx.shadowBlur=10;path(glow,color,params.lineWidth+1);ctx.restore();}let d=clamp(t)*sum;for(let j=0;j<lengths.length;j++){if(d<=lengths[j]||j===lengths.length-1){const q=lengths[j]?d/lengths[j]:0;dot(mix(points[j][0],points[j+1][0],q),mix(points[j][1],points[j+1][1],q),color,size);break;}d-=lengths[j];}}
const slotShade=value=>diagram.strength((value-.08)/.84),massShade=value=>diagram.strength(value/(1.6*params.initialMass));
function vector(x,y,values,color,scale=1,vertical=true,opacity=1,shade=null){alpha(opacity,()=>{const width=9*scale,length=64*scale,strength=values.reduce((sum,v)=>sum+Math.abs(v),0)/values.length;alpha(shade??(diagram.strength(strength)),()=>box(x-(vertical?width:length)/2,y-(vertical?length:width)/2,vertical?width:length,vertical?length:width,color,null,params.cellRadius));});}
function moduleBox(x,y,w,h,name,color,lit=false,radius=Math.min(params.panelRadius,12)){box(x,y,w,h,C.paper,null,radius);box(x,y,w,h,color+(lit?'18':'08'),lit?color:C.line,radius);label(name,x+w/2,y+h/2,lit?color:C.ink,16);}
function moduleOpacity(start,end){const fade=params.moduleFade;return ease((elapsed-stageStart(start))/fade)*(1-ease((elapsed-stageStart(end))/fade));}
function outsideShapes(shapes,draw){ctx.save();for(const shape of shapes){const mask=new Path2D();mask.rect(0,0,W,H);mask.addPath(shape);ctx.clip(mask,'evenodd');}draw();ctx.restore();}
function outsideModules(rects,draw){outsideShapes(rects.map(([x,y,w,h,r=Math.min(params.panelRadius,12)])=>{const shape=new Path2D();shape.roundRect(x,y,w,h,Math.min(r,w/2,h/2));return shape;}),draw);}
function verticalModule(x,y,width,height,name,color,depth=0,radius=Math.min(params.panelRadius,12)){moduleBox(x-width/2,y,width,height,'',color,true,radius);alpha(depth,()=>box(x-width/2,y,width,height,color+'55',color,radius));ctx.save();ctx.translate(x,y+height/2);ctx.rotate(-Math.PI/2);ctx.fillStyle=diagram.text(color);ctx.font=`600 ${16*params.fontScale}px "Segoe UI",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,0,0);ctx.restore();}
function viewport(){const step=Math.max(AW/data.N,28)*params.zoom,width=data.N*step,offset=Math.max(0,width-AW)*pan;return {step,offset,x:j=>AX+(j+.5)*step-offset,cell:Math.min(42,step-params.gap),first:Math.max(0,Math.floor(offset/step)),last:Math.min(data.N-1,Math.ceil((offset+AW)/step)-1),width};}
function clipAddresses(fn){ctx.save();ctx.beginPath();ctx.rect(AX,64,AW,510);ctx.clip();fn();ctx.restore();}
function architecture(i,p){
 const gateX=69,gammaX=137,vX=206,kX=304,stackX=12,stackY=14,qX=kX-stackX,gap=params.connectorGap,bottom=633,outputLinearY=92,multiplyY=outputLinearY+44+params.upperModuleGap,normY=multiplyY+8+params.upperModuleGap;
 const readLinearY=568-stackY,readDecoderY=454-stackY,readCapeY=399-stackY;
 const lowerTop=[568,568,568,readLinearY,568],inputColumns=[gateX,gammaX,vX,qX,kX],signalColors=[C.purple,C.purple,C.v,params.readColor,params.writeColor],consumedAt=[11,5,6,7,1];
 const inputRoutes=inputColumns.map((cx,j)=>roundedRoute([[vX,bottom],[cx,bottom],[cx,lowerTop[j]+38+gap]])),inputMotionRoutes=inputColumns.map((cx,j)=>roundedRoute([[vX,bottom],[cx,bottom],[cx,lowerTop[j]+19]])),gateRoute=roundedRoute([[gateX,568-gap],[gateX,multiplyY],[202-gap,multiplyY]]);
 const linearShape=(cx,yy,ww,hh,flip=false)=>{
  const points=[[cx-ww/2,yy+hh],[cx-ww*.28,yy],[cx+ww*.28,yy],[cx+ww/2,yy+hh]].map(([px,py])=>[px,flip?2*yy+hh-py:py]),radius=Math.min(params.panelRadius*.4,ww*.08,hh*.22),shape=new Path2D();
  shape.moveTo((points[3][0]+points[0][0])/2,(points[3][1]+points[0][1])/2);
  points.forEach((point,j)=>shape.arcTo(...point,...points[(j+1)%points.length],radius));shape.closePath();return shape;
 };
 const linearShapes=[linearShape(gateX,568,64,38),linearShape(gammaX,568,56,38),linearShape(vX,568,66,38),linearShape(qX,readLinearY,88,38),linearShape(kX,568,88,38),linearShape(210,outputLinearY,78,36,true)];
 const moduleShapes=[...linearShapes];
 for(const [x,y,w,h,r] of [[116,304,217,40,6],[qX-45.5,readDecoderY,91,70,params.panelRadius],[kX-45.5,454,91,70,params.panelRadius],[174,normY,72,35,params.panelRadius]]){const shape=new Path2D();shape.roundRect(x,y,w,h,Math.min(r,w/2,h/2));moduleShapes.push(shape);}
 for(const [x,y,r] of [[gateX,421,10],[qX,readCapeY,10],[kX,399,10],[210,multiplyY,8]]){const shape=new Path2D();shape.ellipse(x,y,r*circleAspect(),r,0,0,Math.PI*2);moduleShapes.push(shape);}
 const arrivalGlow=(stage,at)=>i===stage?phase(p,at,at+.08)*(1-phase(p,.9,1)):0;
 const decoderGlow=start=>i===start?phase(p,.23,.31):i===start+1?1-phase(p,.85,1):0;
 const gsuGlow=Math.max(arrivalGlow(4,.61),arrivalGlow(5,.74),arrivalGlow(6,.74),i===10?phase(p,.42,.5):i===11?1-phase(p,.17,.38):0);
 const panel=(px,py,pw,ph,color,brightness,radius=params.panelRadius)=>{box(px,py,pw,ph,C.paper,null,radius);box(px,py,pw,ph,color+'12',color+'88',radius);alpha(brightness,()=>box(px,py,pw,ph,color+'28',color,radius));};
 outsideShapes(moduleShapes,()=>{
  path([[vX,684],[vX,bottom]],C.link);inputRoutes.forEach(route=>routeArrow(route,C.link));
  routeArrow(gateRoute,C.link);verticalLink(gammaX,568,344);verticalLink(vX,568,344);
  verticalLink(qX,readLinearY,524);verticalLink(kX,568,524);
  verticalLink(qX,readDecoderY,readCapeY+10);verticalLink(kX,454,409);verticalLink(qX,readCapeY-10,344);verticalLink(kX,389,344);
  verticalLink(210,304,normY+35);verticalLink(210,normY,multiplyY+8);verticalLink(210,multiplyY-8,outputLinearY+36);arrow([[210,outputLinearY-gap],[210,30]],C.link);
  const loopTip=344+gap,loopEndX=129,loopHead=Math.min(8,gap),loopControl=[105,382],loopAngle=Math.atan2(loopTip-loopControl[1],loopEndX-loopControl[0]);
  ctx.beginPath();ctx.moveTo(129,304-gap);ctx.bezierCurveTo(129,265,86,275,86,325);ctx.bezierCurveTo(86,383,...loopControl,loopEndX,loopTip);
  ctx.strokeStyle=C.red;ctx.lineWidth=params.lineWidth;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
  path([[loopEndX-loopHead*Math.cos(loopAngle-.65),loopTip-loopHead*Math.sin(loopAngle-.65)],[loopEndX,loopTip],[loopEndX-loopHead*Math.cos(loopAngle+.65),loopTip-loopHead*Math.sin(loopAngle+.65)]],C.red);
 });
 label('γ',147,371,C.purple,19,'center',true);label('v',216,371,C.v,19,'center',true);label('q',qX-12,539,params.readColor,19,'center',true);label('k',kX+12,539,params.writeColor,19,'center',true);label('r',qX-12,359,params.readColor,19,'center',true);label('w',kX+14,365,params.writeColor,19,'center',true);label('o',224,(339+normY)/2,C.slot,19,'center',true);
 const a=phase(p,.05,.9);
 // Clip every module separately so overlapping transparent faces never reveal a signal.
 outsideShapes(moduleShapes,()=>{
  if(i===0){
   if(p<.28)along([[vX,684],[vX,bottom]],phase(p,0,.28),C.token,3.5);
   else if(p<.62)inputMotionRoutes.forEach(route=>along(route.points,phase(p,.28,.62),C.token,3));
  }
  inputColumns.forEach((cx,j)=>{const waitY=lowerTop[j]-gap-7;if(i===0)alpha(phase(p,.58,.8),()=>dot(cx,mix(waitY+10,waitY,phase(p,.58,.8)),signalColors[j],3));else if(i<consumedAt[j])dot(cx,waitY,signalColors[j],3);});
  if(i===1||i===7){const key=i===1,x=key?kX:qX;along([[x,lowerTop[key?4:3]-gap-7],[x,key?489:readDecoderY+35]],phase(p,.05,.42),key?params.writeColor:params.readColor);}
  if(i===3||i===9){const key=i===3,x=key?kX:qX;along([[x,key?489:readDecoderY+35],[x,key?399:readCapeY]],phase(p,.05,.35),key?params.writeColor:params.readColor);}
  if(i===4)along([[kX,399],[kX,324]],a,params.writeColor,4,30+gap);
  if(i===5)along([[gammaX,553],[gammaX,324]],a,C.purple,4,30+gap);
  if(i===6)along([[vX,553],[vX,324]],a,C.v,4,30+gap);
  if(i===10){along([[qX,readCapeY],[qX,324]],phase(p,.05,.62),params.readColor,4,30+gap);if(p>.62)along([[210,324],[210,304-gap]],phase(p,.62,.93),C.slot);}
  if(i===11){along([[210,304-gap],[210,multiplyY+15]],phase(p,.05,.7),C.slot,3);along([[gateX,553],[gateX,410]],a,C.purple);}
  if(i===12){const merge=phase(p,.7,.9);if(p<.7)along(roundedRoute([[gateX,410],[gateX,multiplyY],[202-gap,multiplyY]]).points,phase(p,.02,.7),C.purple,3);else dot(mix(202-gap,210,merge),multiplyY,C.purple,3);dot(210,mix(multiplyY+15,multiplyY,merge),C.slot,3);}
  if(i===13)along([[210,multiplyY],[210,outputLinearY-gap],[210,30]],a,C.slot);
 });
 const linear=(shape,cx,yy,name,lit=false,hh=38)=>{
  ctx.fillStyle=C.purple+'22';ctx.fill(shape);ctx.strokeStyle=C.purple+'88';ctx.lineWidth=params.lineWidth;ctx.stroke(shape);alpha(lit,()=>{ctx.fillStyle=C.purple+'30';ctx.fill(shape);ctx.strokeStyle=C.purple;ctx.stroke(shape);});if(name)label(name,cx,yy+hh/2,C.purple,15);
 };
 const linearFlash=arrivalGlow(0,.58);
 linear(linearShapes[0],gateX,568,'Linear',linearFlash);linear(linearShapes[1],gammaX,568,'Lin.',linearFlash);linear(linearShapes[2],vX,568,'Linear',linearFlash);
 outsideShapes([linearShapes[4]],()=>linear(linearShapes[3],qX,readLinearY,'',linearFlash));linear(linearShapes[4],kX,568,'Linear',linearFlash);
 const linearArrival=(multiplyY-outputLinearY-36)/(multiplyY-30),linearGlow=i===13?phase(a,linearArrival,linearArrival+.1)*(1-phase(p,.9,1)):0;
 linear(linearShapes[5],210,outputLinearY,'Linear',linearGlow,36);
 panel(116,304,217,40,C.gsu,gsuGlow,6);label('Gated Sparse Update',224.5,324,C.gsu,16);
 outsideModules([[kX-45.5,454,91,70,params.panelRadius]],()=>panel(qX-45.5,readDecoderY,91,70,C.gold,decoderGlow(7)));panel(kX-45.5,454,91,70,C.gold,decoderGlow(1));label('Address',kX,478,C.gold,15);label('Decoder',kX,500,C.gold,15);
 const normArrival=(304-gap-normY-35)/(304-gap-multiplyY-15),normGlow=i===11?phase(phase(p,.05,.7),normArrival,normArrival+.1)*(1-phase(p,.9,1)):0;
 panel(174,normY,72,35,C.gold,normGlow);label('Norm',210,normY+17.5,C.gold,16);
 const multiplyGlow=arrivalGlow(12,.7);
 roundSymbol(210,multiplyY,()=>{alpha(multiplyGlow,()=>circle(0,0,15,C.purple+'40',C.purple));circle(0,0,8,C.paper,C.link);alpha(multiplyGlow,()=>circle(0,0,8,C.purple+'78',C.purple));path([[-4,-4],[4,4]],C.purple,1.5);path([[-4,4],[4,-4]],C.purple,1.5);});
 sigmoidSymbol(69,421,10,arrivalGlow(11,.69));
 for(const [cx,cy,stage] of [[qX,readCapeY,9],[kX,399,3]])roundSymbol(cx,cy,()=>{const lit=arrivalGlow(stage,.29);alpha(lit,()=>circle(0,0,16,C.gold+'40',C.gold));circle(0,0,10,C.paper,C.gold);alpha(lit,()=>circle(0,0,10,C.gold+'85',C.gold));curve([[-7,0],[-4,-8],[-1,-8],[1,0]],C.gold);curve([[1,0],[3,8],[5,8],[7,0]],C.gold);});
}
function memoryRow(i,p,view){
 const writeProgress=i<6?0:i===6?phase(p,.7,.96):1,readSelection=i===10?1-phase(p,.84,.9):0;
 clipAddresses(()=>{for(let j=view.first;j<=view.last;j++){
  const x=view.x(j),s=view.cell,wi=data.wk.find(k=>data.dest(k)===j),ri=data.rk.find(k=>data.dest(k)===j),writing=wi!==undefined,reading=ri!==undefined&&readSelection>0;
  const slotWidth=Math.min(14,s),strength=memory[j].reduce((sum,v,d)=>sum+mix(v,data.updated[j][d],writeProgress),0)/memory[j].length;
  alpha(slotShade(strength),()=>box(x-slotWidth/2,120,slotWidth,74,C.slot,null,params.cellRadius));
  const currentMass=mix(mass[j],data.updatedMass[j],writeProgress);
  alpha(massShade(currentMass),()=>box(x-slotWidth/2,108,slotWidth,4,C.mass,null,Math.min(params.cellRadius,2)));
  if(writing&&i>=4&&i<=6||reading)alpha(reading?readSelection:1,()=>box(x-slotWidth/2-3,117,slotWidth+6,80,null,C.slot,params.cellRadius+2));
 }});
 label('slot array',AX+AW/2,76,C.muted,19);path([[AX,97],[AX+AW,97]],C.line);
}
function gsuModules(i,p,view,connectors=false){
 const fade=moduleOpacity(4,7);if(fade===0)return;
 const top=194+params.memoryGap,wProgress=i===4?phase(p,.65,.94):i>4?1:0,etaProgress=i===5?phase(p,.62,.92):i>5?1:0;
 const weights=data.wk.map(j=>data.w[j]),rates=data.wk.map(j=>data.eta[j]),wMin=Math.min(...weights),wMax=Math.max(...weights),etaMin=Math.min(...rates),etaMax=Math.max(...rates);
 const relative=(value,min,max)=>max-min>1e-9?(value-min)/(max-min):.5;
 alpha(fade,()=>clipAddresses(()=>{for(const j of data.wk){const x=view.x(data.dest(j)),width=Math.min(28,view.cell,view.step-2*params.lineWidth-4);if(x<AX-width||x>AX+AW+width)continue;if(connectors){const gap=Math.min(params.connectorGap,(top-197-5)/2),start=top-gap,end=197+gap;arrow([[x,start],[x,end]],C.slot,Math.min(6,(start-end)*.6));}else {const weighted=data.w[j]*data.N,weightDepth=.28+.6*(.5*Math.sqrt(weighted/(weighted+3))+.5*relative(data.w[j],wMin,wMax)),rate=data.eta[j],etaDepth=.28+.6*(.5*Math.sqrt(rate/(rate+.22))+.5*relative(rate,etaMin,etaMax)),depth=mix(.18,mix(weightDepth,etaDepth,etaProgress),wProgress);verticalModule(x,top,width,78,'GSU',C.gsu,depth,4);}}}));
}
const sources=[{x:490,c:()=>C.purple,label:'gate'},{x:656,c:()=>C.purple,label:'γ'},{x:820,c:()=>C.v,label:'v'},{x:1035,c:()=>params.readColor,label:'q'},{x:1200,c:()=>params.writeColor,label:'k'}];
function inputs(i,p){
 const entry=i===0?phase(p,.42,.92):1,exit=i===14?1-phase(p,0,.3):1;
 if(i===0&&p<=.42){const rise=phase(p,0,.42),width=mix(30,10,rise),height=mix(30,74,rise),y=mix(718,617,rise);box(870-width/2,y-height/2,width,height,C.token,null,params.cellRadius);return;}
 alpha(exit,()=>{sources.forEach((s,n)=>{const consumed=[11,5,6,7,1][n],a=i>=consumed?0:1,x=mix(870,s.x,entry),y=617;
  alpha(entry*(i>consumed?0:i===consumed?1-phase(p,0,.12):1),()=>label(s.label,x,617+36.8*params.idleScale+18,s.c(),20*params.idleScale,'center',true));
  if(n===1){const side=14*params.idleScale;alpha(a*entry,()=>box(x-side/2,y-side/2,side,side,s.c(),null,params.cellRadius));}else {const values=n===0?data.gate:n===2?data.v:n===3?data.qVisual:data.kVisual;vector(x,y,values,s.c(),1.15*params.idleScale,true,a*entry,n===2?data.vShade:null);}
 });});
 if(i===0){const scale=mix(1,params.idleScale,entry);alpha(1-entry,()=>box(870-5*scale,617-37*scale,10*scale,74*scale,C.token,null,params.cellRadius));}
}
function product(i,p,view){
 const reading=i>=7,local=reading?i-7:i,color=reading?params.readColor:params.writeColor,factors=reading?data.qf:data.kf,dist=reading?data.r:data.w,keys=reading?data.rk:data.wk;
 const shown=i>=1&&i<=4||i>=7&&i<=9;if(!shown)return;
 // Both key and query use the same column-to-row decoder on the same timeline.
 const inProduct=reading?i===7:i===1,pruning=reading?i===8:i===2,cape=reading?i===9:i===3,lifting=!reading&&i===4;
 const scan=inProduct?phase(p,.65,.96):1,cut=inProduct?phase(p,.38,.49):1,spread=inProduct?phase(p,.38,.55):1,subvecRise=inProduct?phase(p,.42,.65):1,subvecGrow=inProduct?phase(p,.48,.65):1,moduleAlpha=moduleOpacity(reading?7:1,reading?8:2);
 const scanIndex=Math.min(data.N-1,Math.floor(scan*data.N)),max=Math.max(...dist);
 ctx.save();ctx.font=`600 ${27*params.fontScale}px "Segoe UI",sans-serif`;const titleWidth=ctx.measureText('Product Softmax').width/(1-(params.archWidth-330)/(W-400));ctx.restore();
 const centerY=500,moduleWidth=Math.max(270,(params.U-1)*params.subvecSpacing+72,titleWidth+32),moduleX=963-moduleWidth/2,moduleY=415,moduleHeight=130,entry=inProduct?phase(p,0,.38):1,sx=reading?1035:1200,values=reading?data.qVisual:data.kVisual,entryX=mix(sx,963,entry),entryY=mix(617,centerY,entry),entryScale=1.15*mix(params.idleScale,1,inProduct?phase(p,0,.18):1);
 if(inProduct)outsideModules([[moduleX,moduleY,moduleWidth,moduleHeight]],()=>vector(entryX,entryY,values,color,entryScale,true,1-cut));
 alpha(moduleAlpha,()=>{
  box(moduleX,moduleY,moduleWidth,moduleHeight,C.paper,color+'60',params.panelRadius);box(moduleX,moduleY,moduleWidth,moduleHeight,color+'06',null,params.panelRadius);label('Product Softmax',963,444,color,27);
  ctx.save();ctx.beginPath();ctx.rect(moduleX+8,463,moduleWidth-16,82);ctx.clip();
  vector(entryX,entryY,values,color,entryScale,true,1-cut);
  const partHeight=73.6/params.U,strength=values.reduce((sum,v)=>sum+Math.abs(v),0)/values.length;
  factors.forEach((_,u)=>{
   const offset=u-(params.U-1)/2,x=963-offset*params.subvecSpacing*spread,y=mix(centerY+offset*partHeight*.72,centerY,subvecRise),height=mix(partHeight-2*cut,46,subvecGrow),width=params.U===1?mix(10.35,8,spread):Math.min(mix(10.35,8,spread),Math.max(0,params.subvecSpacing*spread-2)),fc=color;
   alpha(cut*(diagram.strength(strength)),()=>box(x-width/2,y-height/2,width,height,fc,null,Math.min(params.cellRadius,3)));
   const digit=Math.floor(scanIndex/params.dp**u)%params.dp,nextDigit=Math.floor(Math.min(scanIndex+1,data.N-1)/params.dp**u)%params.dp,position=mix(digit,nextDigit,ease(scan*data.N%1)),scanY=centerY-23+(position+.5)*46/params.dp;
   alpha(inProduct?phase(p,.65,.68):1,()=>box(x-11,scanY-1.25,22,2.5,fc,null,1));
  });
  ctx.restore();
 });
 const remove=pruning?phase(p,.55,.95):local>=(reading?2:3)?1:0,shift=cape?data.shift*phase(p,.12,.9):(lifting?data.shift:0),rise=lifting?phase(p,0,.9):0,gsuBottom=194+params.memoryGap+78,rowY=mix(370,gsuBottom-12,rise),visibility=lifting?1-phase(p,.62,.95):1;
 alpha(visibility,()=>{
  alpha(inProduct?phase(p,.65,.68):1,()=>label(reading?'r':'w',409,rowY,color,22,'center',true));
  clipAddresses(()=>{for(let j=0;j<data.N;j++){
   if(inProduct&&(p<.65||j>scanIndex))continue;const selected=keys.includes(j),a=selected?1:1-remove;
   const dest=mod(j-shift,data.N),x=view.x(dest);if(x<AX-view.step||x>AX+AW+view.step)continue;
   const s=Math.min(view.cell,35);
   if(!selected&&(pruning||cape||lifting))alpha(remove*.6*(lifting?1-phase(p,0,.75):1),()=>{ctx.setLineDash([4,4]);box(x-s/2,rowY-s/2,s,s,null,color,params.cellRadius);ctx.setLineDash([]);});
   alpha(a,()=>{alpha(.13+.87*Math.sqrt(dist[j]/max),()=>box(x-s/2,rowY-s/2,s,s,color,null,params.cellRadius));
    if(pruning&&!selected){const cross=phase(p,.06,.32)*(1-remove);alpha(cross,()=>{const h=Math.min(9,s*.31);path([[x-h,rowY-h],[x+h,rowY+h]],C.red,2);path([[x-h,rowY+h],[x+h,rowY-h]],C.red,2);});}
    if(inProduct&&j===scanIndex)box(x-s/2-3,rowY-s/2-3,s+6,s+6,null,color,params.cellRadius);
    if(lifting&&selected){const cellTop=rowY-s/2,gap=Math.min(params.connectorGap,Math.max(2,(cellTop-gsuBottom-5)/2)),startY=cellTop-gap,endY=gsuBottom+gap;if(startY>endY+3){ctx.save();ctx.shadowColor=color;ctx.shadowBlur=10;arrow([[x,startY],[x,endY]],color+'99',Math.min(6,(startY-endY)*.6));ctx.restore();}}
   });
  }});
 });
}
function capeModule(){
 for(const [start,end,color] of [[3,4,params.writeColor],[9,10,params.readColor]]){const fade=moduleOpacity(start,end);if(fade===0)continue;alpha(fade,()=>{box(AX-40,308,AW+58,140,color+'08',color+'70',params.panelRadius);label('CAPE',AX+AW/2,328,color,28);arrow([[1020,416],[758,416]],color);label('t = '+(initialTime+round),1044,416,color,18,'left',true);});}
}
function curveToVertical(route,progress,targetY){
 const points=[route[0]],distances=[0];let curveLength=0;
 for(let n=1;n<=96;n++){const point=curvePoint(route,n/96),previous=points.at(-1);curveLength+=Math.hypot(point[0]-previous[0],point[1]-previous[1]);points.push(point);distances.push(curveLength);}
 const end=route[3],straightLength=Math.abs(end[1]-targetY),distance=clamp(progress)*(curveLength+straightLength);
 // One distance clock spans the curve and the straight passage that follows it.
 if(distance>=curveLength){const write=clamp((distance-curveLength)/straightLength);return {x:end[0],y:mix(end[1],targetY,write),write};}
 for(let n=1;n<points.length;n++)if(distance<=distances[n]){const q=(distance-distances[n-1])/(distances[n]-distances[n-1]);return {x:mix(points[n-1][0],points[n][0],q),y:mix(points[n-1][1],points[n][1],q),write:0};}
}
function vMotion(route,p){return curveToVertical(route,(p-.22)/.74,157);}
function broadcasts(i,p,view){
 if(i!==5&&i!==6)return;
 const gamma=i===5,color=gamma?C.purple:C.v,source=gamma?sources[1]:sources[2],junctionY=475,fan=phase(p,.22,.66),write=phase(p,.66,.96),fade=1-phase(p,.9,1),gsuTop=194+params.memoryGap,inputScale=mix(params.idleScale,1,phase(p,0,.18));
 alpha(fade,()=>{
  const routes=data.wk.map(j=>{const x=view.x(data.dest(j)),endY=gsuTop+78;return {j,x,endY,route:[[source.x,junctionY],[source.x,388],[x,380],[x,endY]]};});
  ctx.save();ctx.beginPath();ctx.rect(AX,64,AW,610);ctx.clip();ctx.beginPath();ctx.moveTo(source.x,617-(gamma?7:36.8)*params.idleScale-params.connectorGap);ctx.lineTo(source.x,junctionY);
  routes.forEach(({x,endY,route},n)=>{if(n)ctx.moveTo(source.x,junctionY);ctx.bezierCurveTo(...route[1],...route[2],x,endY+params.connectorGap+params.lineWidth/2+.5);});
  ctx.strokeStyle=color+'65';ctx.lineWidth=params.lineWidth;ctx.lineCap='round';ctx.lineJoin='round';if(p>.02&&p<.96){ctx.shadowColor=color;ctx.shadowBlur=11;}ctx.stroke();ctx.restore();
  const y=mix(617,junctionY,phase(p,0,.22));
  alpha(1-phase(p,.22,.28),()=>{if(gamma){const side=14*inputScale;box(source.x-side/2,y-side/2,side,side,color,null,params.cellRadius);}else vector(source.x,y,data.v,color,1.15*inputScale,true,1,data.vShade);});
  clipAddresses(()=>{for(const {j,x,endY,route} of routes){
   const visible=phase(p,.22,.28);
   if(gamma){const [xx,yy]=curvePoint(route,fan),cy=write>0?mix(endY,gsuTop+39,write):yy;alpha(visible,()=>box(xx-7,cy-7,14,14,color,null,params.cellRadius));}
   else {const motion=vMotion(route,p),values=data.v.map((v,d)=>mix(v,data.updated[data.dest(j)][d],motion.write)),level=values.reduce((sum,value)=>sum+value,0)/values.length;vector(motion.x,motion.y,values,motion.y<gsuTop+39?C.slot:color,1.15,true,visible,mix(data.vShade,slotShade(level),motion.write));}
  }});
 });
}
function outputPosition(time=elapsed){const start=stageStart(10)+duration(10)*.9,end=stageStart(14);return mix(755,1365,clamp((time-start)/(end-start)));}
function readout(i,p,view){
 if(i<10||i>13)return;
 const color=C.slot,oX=755,oY=460,normX=885,sigmoidY=530,catchTime=stageStart(12)+duration(12)*.7,catchX=outputPosition(catchTime),gateBlend=ease((elapsed-catchTime+.12)/.24),x=outputPosition();
 if(i===10){
  const size=Math.min(view.cell,35),rowY=mix(370,194+Math.max(params.memoryGap+size/2,48.8),phase(p,0,.22)),drop=phase(p,.22,.46),merge=phase(p,.46,.9),fade=1-phase(p,.84,.9),max=Math.max(...data.r),lineEnd=oY-64*1.15/2-params.connectorGap-params.lineWidth/2;
  alpha(fade,()=>label('r',409,rowY,params.readColor,22,'center',true));
  clipAddresses(()=>{
   alpha(.6*(1-phase(p,0,.22)),()=>{ctx.setLineDash([4,4]);for(let j=0;j<data.N;j++){if(data.rk.includes(j))continue;const px=view.x(data.dest(j));if(px<AX-size||px>AX+AW+size)continue;box(px-size/2,rowY-size/2,size,size,null,params.readColor,params.cellRadius);}ctx.setLineDash([]);});
   for(const j of data.rk){
    const id=data.dest(j),sx=view.x(id),weight=data.r[j],lineStart=rowY+size/2+params.connectorGap+params.lineWidth/2,bend=Math.min(55,(lineEnd-lineStart)*.38),route=[[sx,lineStart],[sx,lineStart+bend],[oX,lineEnd-bend],[oX,lineEnd]],point=merge>0?curveToVertical(route,merge,oY):{x:sx,y:mix(157,lineStart,drop)},attenuate=phase(p,.43,.55),strength=Math.sqrt(weight/max);
    alpha(fade*phase(p,.42,.5),()=>{ctx.save();ctx.shadowColor=color;ctx.shadowBlur=11;curve(route,color+'55');ctx.restore();});
    const visible=phase(p,.2,.26)*fade,values=data.updated[id].map(v=>v*mix(1,weight,attenuate));
    vector(point.x,point.y,values,color,mix(.65,1.15,merge),true,visible*mix(1,.25+.75*strength,attenuate));
   }
   alpha(fade,()=>{for(const j of data.rk){const x=view.x(data.dest(j));box(x-size/2,rowY-size/2,size,size,C.paper,null,params.cellRadius);alpha(.2+.8*Math.sqrt(data.r[j]/max),()=>box(x-size/2,rowY-size/2,size,size,params.readColor,null,params.cellRadius));}});
  });
 }
 const visible=i===10?phase(p,.84,.9):1-ease((elapsed-(stageStart(14)-.3))/.3),normalized=phase(x,normX-17,normX+17),outputBlend=i===13?p:0;
 const values=data.o.map((v,d)=>mix(mix(mix(v,data.norm[d],normalized),data.gated[d],gateBlend),data.output[d],outputBlend));
 const sigmoidAlpha=moduleOpacity(11,12),normAlpha=ease((elapsed-stageStart(11))/params.moduleFade)*(1-ease((elapsed-stageStart(12))/Math.min(params.moduleFade,duration(12)*.25)));
 // Mask each module only while its face is visible.
 ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);if(normAlpha>0)ctx.roundRect(normX-17,oY-50,34,100,Math.min(params.panelRadius,12));ctx.moveTo(490+18*circleAspect(),sigmoidY);ctx.ellipse(490,sigmoidY,18*circleAspect(),18,0,0,Math.PI*2);ctx.clip('evenodd');
 vector(x,oY,values,color,1.15,true,visible);
 if(i>=11){let gateX=490,gateY=mix(617,oY,phase(elapsed,stageStart(11),stageStart(12)));if(elapsed>=stageStart(12)){gateX=mix(490,catchX,clamp((elapsed-stageStart(12))/(catchTime-stageStart(12))));gateY=oY;if(elapsed>=catchTime)gateX=x;}const scale=1.15*mix(params.idleScale,1,phase(elapsed,stageStart(11),stageStart(11)+duration(11)*.25));vector(gateX,gateY,data.gate,C.purple,scale,true,1-ease((elapsed-catchTime)/.25));}
 ctx.restore();
 alpha(visible*(1-gateBlend),()=>label('o',x,oY+68,color,21,'center',true));
 if(normAlpha>0)alpha(normAlpha,()=>verticalModule(normX,oY-50,34,100,'Norm',C.gold));
 if(sigmoidAlpha>0)alpha(sigmoidAlpha,()=>sigmoidSymbol(490,sigmoidY,18));
}
function tokenBelt(i,p){
 const {step,size:s,center,right}=tokenBeltLayout,advance=i===14?phase(p,.05,.95):0;
 ctx.save();ctx.beginPath();ctx.rect(422,690,right-422,83);ctx.clip();path([[437,721],[1336,721]],C.line,1);
 for(let j=-9;j<=Math.min(9,initialTime+round-1);j++){const x=center+(j+advance)*step,consumed=j>0||j===0&&(i>0||p>0);
  box(x-s/2,704,s,s,consumed?C.tokenSpent:C.token,consumed?null:C.tokenDone,params.cellRadius);if(j===0&&i<14)box(x-s/2-4,700,s+8,s+8,null,consumed?C.tokenSpent:C.tokenDone,params.cellRadius+2);
 }
 ctx.restore();
}
function render(){
 const {i,p}=locationAt(),view=viewport();ctx.clearRect(0,0,W,H);
 const extraWidth=params.archWidth-330,rightScale=1-extraWidth/(W-400);
 path([[388+extraWidth,57],[388+extraWidth,750]],C.line,1);
 ctx.save();ctx.translate(30,params.archOffsetY);ctx.scale(params.archWidth/330,1);ctx.translate(-30,0);architecture(i,p);ctx.restore();
 ctx.save();ctx.translate(W*(1-rightScale),0);ctx.scale(rightScale,1);
 memoryRow(i,p,view);gsuModules(i,p,view,true);capeModule();inputs(i,p);
 const gsuWidth=Math.min(28,view.cell,view.step-2*params.lineWidth-4),gsuMasks=moduleOpacity(4,7)>0?data.wk.map(j=>[view.x(data.dest(j))-gsuWidth/2,194+params.memoryGap,gsuWidth,78,4]):[];
 outsideModules(gsuMasks,()=>{product(i,p,view);broadcasts(i,p,view);});
 readout(i,p,view);gsuModules(i,p,view);tokenBelt(i,p);ctx.restore();
 stageTimeline.update(elapsed);canvas.classList.toggle('pannable',view.width>AW+.01);
}
function resize(){const dpr=Math.min(devicePixelRatio||1,2),width=Math.max(880,canvas.clientWidth),height=width/params.aspectRatio;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);render();}
function updatePlayback(){window.RamnetRuntime.setPlaybackIcon($('play'),playing);lastTime=null;}
function seekStage(i,part=.1){playing=false;i=clamp(i,0,stages.length-1);elapsed=groupStart(i)+groupDuration(i)*part;updatePlayback();render();}
function buildActions(){stageTimeline.setStages(stages.map(([,label,,,description],i)=>({label,description,duration:groupDuration(i)})));}
function applyStyle(){Object.assign(C,params.colors);const style=document.documentElement.style;for(const key of ['bg','paper','ink','muted','line','accent','highlight','frame'])style.setProperty('--'+key,C[key]);style.setProperty('--radius',params.panelRadius+'px');style.setProperty('--spacing',params.spacing+'px');style.setProperty('--ui-scale',params.uiScale);style.setProperty('--scene-ratio',params.aspectRatio);}
function togglePlay(){if(elapsed>=total()){if(params.loop)nextRound();else resetSimulation();}playing=!playing;updatePlayback();render();}
function frame(timestamp){if(lastTime!==null&&playing){elapsed+=Math.min((timestamp-lastTime)/1000,.1)*params.speed;if(elapsed>=total()){if(params.loop){const remaining=elapsed-total();nextRound();elapsed=remaining;}else{elapsed=total();playing=false;updatePlayback();}}render();}lastTime=timestamp;requestAnimationFrame(frame);}
document.addEventListener('visibilitychange',()=>{lastTime=null;});
document.addEventListener('keydown',event=>{if(event.target.closest('input,select,button,summary,textarea'))return;if(event.code==='Space'){event.preventDefault();togglePlay();}if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();playing=false;elapsed=clamp(elapsed+(event.key==='ArrowLeft'?-.12:.12),0,total());updatePlayback();render();}});
$('play').onclick=togglePlay;$('restart').onclick=()=>{resetSimulation();playing=true;updatePlayback();render();};$('previous').onclick=()=>seekStage(stageForAction(locationAt().i)-1);$('next').onclick=()=>seekStage(stageForAction(locationAt().i)+1);
let dragPan=null;
canvas.addEventListener('pointerdown',event=>{if(viewport().width<=AW+.01)return;dragPan={id:event.pointerId,x:event.clientX,pan};canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');});
canvas.addEventListener('pointermove',event=>{if(!dragPan||event.pointerId!==dragPan.id)return;const rightScale=1-(params.archWidth-330)/(W-400),pixelsPerUnit=canvas.getBoundingClientRect().width/W*rightScale;pan=clamp(dragPan.pan-(event.clientX-dragPan.x)/((viewport().width-AW)*pixelsPerUnit));render();});
canvas.addEventListener('lostpointercapture',()=>{dragPan=null;canvas.classList.remove('dragging');});

resetSimulation();scope.setCycleDuration?.(total()/params.speed);applyStyle();buildActions();updatePlayback();resize();new ResizeObserver(resize).observe(canvas);document.body.getRootNode().host?.addEventListener('ramnet:fit',resize);scope.onAutoplayStart?.(event=>{if(!event.detail?.resumeCurrent){$('restart').click();return;}event.detail.remainingMs=Math.max(0,(total()-elapsed)/params.speed*1000);playing=true;lastTime=null;updatePlayback();render();});requestAnimationFrame(frame);
};
if (document.body.classList.contains('exhibit-ramnet_arch')) window.RamnetRuntime.mountStandalone('ramnet_arch');
