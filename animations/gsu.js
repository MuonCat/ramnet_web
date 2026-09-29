window.RamnetAnimations ??= {};
window.RamnetAnimations.gsu = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame} = scope;
'use strict';
const diagram=window.ramnetDiagramTheme;
const $=id=>document.getElementById(id), canvas=$('scene'), ctx=canvas.getContext('2d');
const colors={mass:diagram.colors.indigo,weight:diagram.colors.red,state:diagram.colors.sky,gold:diagram.colors.gold,alpha:diagram.colors.purple,eta:diagram.colors.green,gamma:diagram.colors.purple,bg:'#f3f2ee',paper:'#eee8db',plot:'#f6f0e3',ink:'#30383f',muted:'#85877f',line:'#c4bdaf',dots:'#e5e8df'};
const actions=['输入 w','门控映射','调节 γ','衰减 m','写入 w','计算 η','输入 v','更新 s','回收状态'];
const contentHeight=800,inputRowY=76,etaMoveSeconds=1.2,etaHoldSeconds=1;
let sceneOffset=0,sceneHeight=contentHeight;
const slotPrepareSpan=.38*(.5-Math.sin(Math.asin(1-2*.22)/3)),slotPrepareDelay=slotPrepareSpan*.5;
const minimumDurations=config=>[1,2.95,0,3,4,0,1+2.5*(1+slotPrepareDelay),4.2,2.5].map((factor,i)=>Math.max(1,Math.ceil((i===5?2*config.fadeDuration+etaMoveSeconds+etaHoldSeconds:factor*config.fadeDuration)*10-1e-9)/10));
function fitDurations(config){const minimum=minimumDurations(config);config.durations=config.durations.map((value,i)=>Math.max(value,minimum[i]));}
const progressGroups=[{name:'calculate α',color:'alpha',start:0,end:3},{name:'update mass',color:'mass',start:3,end:5,stop:.5},{name:'calculate η',color:'eta',start:5,end:6},{name:'update slot',color:'state',start:6,end:9,stopAction:7}];
const defaults={colors:{...colors},n:8,initialMass:0.8,epsilon:0.0001,concentration:0.5,gammaRange:3.5,speed:1,loop:true,aspectRatio:1.95,retainedGap:200,columnSpacing:0.55,slotGap:7,cellRadius:6,panelRadius:22,spacing:20,lineWidth:2.2,vectorScale:0.94,massContrast:1.6,fadeDuration:1.2,interactionExitDelay:3,canvasExitDelay:1,durations:[1.5,3.6,4,3.6,4.8,4.6,4.4,5.1,3]};
let params=structuredClone(defaults),elapsed=0,playing=true,lastFrame=0,toastTimer,activeAction=-1,roundData,gammaOverride=null;
let sceneWidth=sceneHeight*params.aspectRatio;
let checkpoint=null,hitRegions=[],hoverVector=null,drag=null,pointerPosition=null,resumeAfterHover=false,hoverTarget=null,hoverExitTimer,hoverExitZone=null,gammaDragging=false;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t,smooth=t=>{t=clamp(t);return t*t*(3-2*t)},phase=(p,a,b)=>smooth((p-a)/(b-a));
const lerpPoint=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
const fadeIn=(i,p,start=0)=>{const t=p*params.durations[i]-start;return t>=params.fadeDuration-1e-9?1:smooth(t/params.fadeDuration);};
const fadeOut=(i,p,start=0)=>1-fadeIn(i,p,start);
const afterFadeProgress=(i,p)=>{const progress=clamp((p*params.durations[i]-params.fadeDuration)/(params.durations[i]-params.fadeDuration));if(i!==6)return progress;
 // Stretch only the preparation interval; rotation and vector copying keep their own time.
 const time=progress*(1+slotPrepareDelay);return time<=.24?time:time<.24+slotPrepareSpan*1.5?.24+(time-.24)/1.5:clamp(time-slotPrepareDelay);
};
const etaMoveProgress=p=>phase(p*params.durations[5],params.fadeDuration,params.fadeDuration+etaMoveSeconds);
const total=()=>params.durations.reduce((a,b)=>a+b,0);
const startOf=i=>params.durations.slice(0,i).reduce((a,b)=>a+b,0);
function stageStop(group){return {i:progressGroups[group].stopAction??progressGroups[group].end-1,p:progressGroups[group].stop??1};}
function locationAt(time=elapsed){if(checkpoint!==null&&time===elapsed)return stageStop(checkpoint);let offset=0;for(let i=0;i<9;i++){if(time<offset+params.durations[i]||i===8)return {i,p:clamp((time-offset)/params.durations[i])};offset+=params.durations[i];}}
function randomUnit(){return (crypto.getRandomValues(new Uint32Array(1))[0]+.5)/4294967296;}
function randomVector(){return {x:(randomUnit()*1.6-.8),y:(randomUnit()*1.6-.8)};}
function sampleRound(m,s){const raw=Array.from({length:params.n},()=>Math.pow(-Math.log(randomUnit()),1/params.concentration));const sum=raw.reduce((a,b)=>a+b,0),w=raw.map(x=>x/sum);return {m,s,w,retainedM:Array(params.n).fill(null),retainedS:Array(params.n).fill(null),massOverride:Array(params.n).fill(null),etaOverride:Array(params.n).fill(null),massScale:Math.max(1,...m.map((value,j)=>value+w[j])),v:randomVector(),gamma:1+(randomUnit()+randomUnit()-1)*Math.min(params.gammaRange,8.9),gammaSweepDirection:randomUnit()<.5?1:-1};}
function initialize(){clearInteraction();elapsed=0;gammaOverride=null;roundData=sampleRound(Array.from({length:params.n},()=>params.initialMass*(.2+randomUnit()*1.6)),Array.from({length:params.n},randomVector));activeAction=-1;}
function gammaAt(i,p){if(gammaOverride!==null)return gammaOverride;if(i<2)return 0;if(i>2)return roundData.gamma;
 const target=roundData.gamma,direction=roundData.gammaSweepDirection,first=clamp(target+direction*params.gammaRange,-9.9,9.9),second=clamp(target-direction*params.gammaRange,-9.9,9.9);
 if(p<1/3)return mix(0,first,smooth(p*3));if(p<2/3)return mix(first,second,smooth(p*3-1));return mix(second,target,smooth(p*3-2));
}
function gammaInMotion(){const {i,p}=locationAt();return i===2&&p<1&&gammaOverride===null||i===3&&p<.4;}
function compute(gamma){const d=roundData;const alpha=d.w.map(w=>(1-w)/(1-w+w*Math.exp(gamma)));const decayed=d.m.map((m,j)=>m*alpha[j]);const mass=decayed.map((m,j)=>d.massOverride[j]??m+d.w[j]);const eta=d.w.map((w,j)=>d.etaOverride[j]??w/(mass[j]+params.epsilon));const state=d.s.map((s,j)=>lerpPoint(s,d.v,eta[j]));return {alpha,decayed,mass,eta,state};}
function retainedValues(result){const {i,p}=locationAt();result??=compute(gammaAt(i,p));const mass=i>6||i===6&&afterFadeProgress(i,p)>=.22?result.mass:roundData.m,state=i===8&&afterFadeProgress(i,p)>=.9?result.state:roundData.s;return {m:mass.map((m,j)=>roundData.retainedM[j]??m),s:state.map((s,j)=>roundData.retainedS[j]??s)};}
function nextRound(){const result=compute(gammaOverride??roundData.gamma),m=result.mass.map((value,j)=>roundData.retainedM[j]??value),s=result.state.map((value,j)=>roundData.retainedS[j]??value);clearInteraction();roundData=sampleRound(m,s);gammaOverride=null;elapsed=0;activeAction=-1;}
function rgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${clamp(a)})`;}
function fade(op,fn){if(op<=0)return;ctx.save();ctx.globalAlpha*=clamp(op);fn();ctx.restore();}
function box(x,y,w,h,fill,stroke,r=params.cellRadius){ctx.beginPath();ctx.roundRect(x,y,w,h,Math.max(0,Math.min(r,w/2,h/2)));if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=params.lineWidth;ctx.stroke();}}
function line(x1,y1,x2,y2,color=colors.line,width=params.lineWidth,dash=[]){ctx.beginPath();ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(dash);ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();ctx.setLineDash([]);}
function arrow(x1,y1,x2,y2,color,progress=1,width=params.lineWidth){const x=mix(x1,x2,clamp(progress)),y=mix(y1,y2,clamp(progress)),length=Math.hypot(x-x1,y-y1);
 // Keep arrows legible after the scene scales down to the article or a phone.
 width=Math.max(width,params.lineWidth*1.25,1.1*sceneWidth/Math.max(1,canvas.clientWidth));
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';line(x1,y1,x,y,color,width);
 if(progress>.02&&length>0){const angle=Math.atan2(y2-y1,x2-x1),head=Math.min(Math.max(8,width*2.8),length*.45);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-head*Math.cos(angle-.48),y-head*Math.sin(angle-.48));ctx.lineTo(x-head*Math.cos(angle+.48),y-head*Math.sin(angle+.48));ctx.closePath();ctx.fillStyle=color;ctx.fill();}
 ctx.restore();}
function label(text,x,y,color=colors.ink,size=24,align='center',italic=true){ctx.font=`${italic?'italic ':''}${color!==colors.ink&&color!==colors.muted?'600':'400'} ${Math.max(14,size*1.12)}px ${italic?'Georgia, "Times New Roman", serif':'Consolas, monospace'}`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=diagram.text(color);ctx.fillText(text,x,y);}
function rateFraction(x){label('w',x,123,colors.eta,19);label('m + ε',x,153,colors.eta,19);const halfWidth=ctx.measureText('m + ε').width/2+5;line(x-halfWidth,138,x+halfWidth,138,diagram.text(colors.eta),1.8);}
function dot(x,y,color,r=3){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
function columnGeometry(x,y,w,h){const gap=Math.min(params.slotGap,h/params.n*.3),cell=Math.min(w,(h-gap*(params.n-1))/params.n),height=params.n*cell+(params.n-1)*gap;x+=(w-cell)/2;y+=(h-height)/2;return {x,y,w:cell,h:height,gap,cell,cy:j=>y+j*(cell+gap)+cell/2};}
function blendGeometry(a,b,t){return {x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),w:mix(a.w,b.w,t),h:mix(a.h,b.h,t),gap:mix(a.gap,b.gap,t),cell:mix(a.cell,b.cell,t),cy:j=>mix(a.cy(j),b.cy(j),t),moving:t<1&&['x','y','w','h','gap','cell'].some(key=>Math.abs(a[key]-b[key])>1e-6)};}
function rotatedSlotCells(source,row,t,layout,kind){const prepare=phase(t,0,.22),angle=phase(t,.22,.8)*Math.PI/2,expand=phase(t,.78,1),sin=Math.sin(angle),cos=Math.cos(angle),pitch=Math.min(68,400/Math.max(1,params.n-1)),compactCell=Math.min(layout.eta.cell,48,(pitch-4)/Math.SQRT2),cell=mix(mix(source.cell,compactCell,prepare),row.cell,expand),cx=layout.stateRow.x+layout.stateRow.width/2,cy=(layout.stateRow.y+layout.etaRow.y)/2,side=kind==='eta'?64:-64;
 // Rotate both compact columns together, then spread and enlarge the horizontal rows.
 return Array.from({length:params.n},(_,j)=>{const offset=(j-(params.n-1)/2)*pitch,rx=cx+cos*side+sin*offset,ry=cy-sin*side+cos*offset,x=mix(mix(source.x+source.w/2,rx,prepare),row.x+row.cell/2+j*row.pitch,expand),y=mix(mix(source.cy(j),ry,prepare),row.y,expand);return {x:x-cell/2,y:y-cell/2,w:cell,h:cell,moving:t<1};});}
function column(g,values,name,color,opacity=1,scale=1,editable=name==='η'?'eta':name,mass=false){fade(opacity,()=>{if(name)label(name,g.x+g.w/2,g.y-27,color,25);values.forEach((v,j)=>{const strength=clamp(v/scale),fill=diagram.strength(mass?Math.pow(strength,params.massContrast):strength);box(g.x,g.cy(j)-g.cell/2,g.w,g.cell,rgba(color,fill),rgba(color,diagram.alpha.border));});});const i=locationAt().i;if(opacity===1&&((editable==='m'&&(values===roundData.m||i===5)||editable==='w')&&i<6||editable==='eta'&&(i===6||i===7)))registerColumn(g,editable,values===roundData.m?'input':'output');}
function columnLinks(a,b,color,p=1){for(let j=0;j<params.n;j++)arrow(a.x+a.w+8,a.cy(j),b.x-8,b.cy(j),rgba(color,diagram.alpha.link),p);}
function rightLinks(a,b,color,p=1){for(let j=0;j<params.n;j++)arrow(a.x-8,a.cy(j),b.x+b.w+8,b.cy(j),rgba(color,diagram.alpha.link),p);}
function vectorMap(g,points){const xs=[0,...points.map(s=>s.x)],ys=[0,...points.map(s=>s.y)],xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),span=Math.max(xmax-xmin,ymax-ymin,1e-6),scale=g.w*.76*params.vectorScale/span;return s=>({x:g.x+g.w/2+(s.x-(xmin+xmax)/2)*scale,y:g.y+g.h/2-(s.y-(ymin+ymax)/2)*scale});}
function vectorAxes(g,origin){const pad=g.w*.1;line(g.x+pad,origin.y,g.x+g.w-pad,origin.y,rgba(colors.muted,.32),1.2);line(origin.x,g.y+pad,origin.x,g.y+g.h-pad,rgba(colors.muted,.32),1.2);dot(origin.x,origin.y,rgba(colors.muted,.65),Math.min(1.6,g.w*.05));}
function miniVector(x,y,w,h,s,color,opacity=1){fade(opacity,()=>{const g={x,y,w,h},map=vectorMap(g,[s]),o=map({x:0,y:0}),v=map(s);vectorAxes(g,o);arrow(o.x,o.y,v.x,v.y,color,1,Math.min(2,g.w*.05));});}
function stateHome(values,opacity=1){const g=columnGeometry(76,432,72,308);fade(opacity,()=>{label('s',g.x+g.w/2,g.y-27,colors.state);for(let j=0;j<params.n;j++){const y=g.cy(j)-g.cell/2;box(g.x,y,g.w,g.cell,rgba(colors.state,.025),rgba(colors.state,.34));miniVector(g.x,y,g.w,g.cell,values[j],colors.state);}});if(opacity===1)registerColumn(g,'s','retained');}
const gateFrame={x:560,y:210,size:410};
function distributeColumns(columns,left,right,gap){const width=columns.reduce((sum,g)=>sum+g.w,0)+gap*(columns.length-1),center=clamp(sceneWidth/2,left+width/2,right-width/2);let x=center-width/2;return columns.map(g=>{const placed={...g,x};x+=g.w+gap;return placed;});}
function massColumns(wg){const home=columnGeometry(76,128,72,256),large=columnGeometry(205,210,88,410),gateAlpha=columnGeometry(378,210,88,410),alpha=columnGeometry(446,210,88,410),newM=columnGeometry(758,210,88,410),etaM=columnGeometry(403,210,88,410),eta=columnGeometry(746,210,88,410),left=76+72+params.retainedGap,right=wg.x+wg.w;
 const columnGap=Math.max(0,Math.min(160,(right-left-gateAlpha.w-gateFrame.size-wg.w)/2))*params.columnSpacing,gate=distributeColumns([gateAlpha,{w:gateFrame.size},wg],left,right,columnGap),update=distributeColumns([large,alpha,newM,wg],left,right,columnGap),rateCenter=sceneWidth/2,rate=[{...etaM,x:rateCenter-eta.w/2-columnGap-etaM.w},{...eta,x:rateCenter-eta.w/2},{...wg,x:rateCenter+eta.w/2+columnGap}];gateFrame.x=gate[1].x;
 const stateLeft=148+params.retainedGap*.25,stateRight=sceneWidth-28,gap=params.slotGap*3*params.columnSpacing,cell=Math.min(180,(stateRight-stateLeft-gap*(params.n-1))/params.n),width=params.n*cell+gap*(params.n-1),stateRow={x:stateLeft+(stateRight-stateLeft-width)/2,y:490,cell,pitch:cell+gap,width},etaSize=Math.min(48,cell*.55),etaRow={...stateRow,x:stateRow.x+(cell-etaSize)/2,y:310,cell:etaSize,width:width-cell+etaSize},vBox={x:stateRight-104,y:640,w:104,h:104};
 return {home,gateAlpha:gate[0],gateW:gate[2],large:update[0],alpha:update[1],newM:update[2],updateW:update[3],etaM:rate[0],eta:rate[1],etaW:rate[2],stateRow,etaRow,vBox};
}
function gateReveal(i,p){if(i===0)return {input:0,frame:0,output:0,alpha:0};const step=params.fadeDuration*.65;if(i===1)return {input:fadeIn(i,p),frame:fadeIn(i,p,step),output:fadeIn(i,p,2*step),alpha:fadeIn(i,p,3*step)};return {input:1,frame:1,output:1,alpha:1};}
function gateLinks(wg,ag,input,output,opacity=1){fade(opacity,()=>{for(let j=0;j<params.n;j++){fade(input,()=>arrow(wg.x-8,wg.cy(j),gateFrame.x+gateFrame.size+8,wg.cy(j),rgba(colors.weight,diagram.alpha.link),input));fade(output,()=>arrow(gateFrame.x-8,ag.cy(j),ag.x+ag.w+8,ag.cy(j),rgba(colors.alpha,diagram.alpha.link),output));}});}
function registerPlotLine(x1,y1,x2,y2,kind,j,part,plotX,plotSize){const pad=6;hitRegions.push({x:Math.min(x1,x2)-pad,y:Math.min(y1,y2)-pad,w:Math.abs(x2-x1)+pad*2,h:Math.abs(y2-y1)+pad*2,kind,j,part,source:'plot',segment:{x1,y1,x2,y2},plotX,plotSize});}
function gatePlot(gamma,alpha,p,opacity){fade(opacity,()=>{const {x,y,size:w}=gateFrame,h=w,pw=w-117,ph=pw,px=x+(w-pw)/2,py=y+66,editable=locationAt().i<3&&opacity===1&&!gammaInMotion();
 box(x,y,w,h,rgba(colors.plot,.38),rgba(colors.line,.85),params.panelRadius);label('σ(logit(1 − w) − γ)',x+w/2,y+30,colors.ink,20);
 for(let k=1;k<4;k++){line(px,py+k*ph/4,px+pw,py+k*ph/4,rgba(colors.line,.7),.7);line(px+k*pw/4,py,px+k*pw/4,py+ph,rgba(colors.line,.7),.7);}
 line(px,py+ph,px+pw+10,py+ph,colors.muted);line(px,py-7,px,py+ph,colors.muted);label('0',px-12,py+ph+14,colors.muted,11,'center',false);label('1',px+pw,py+ph+16,colors.muted,11,'center',false);label('1',px-15,py,colors.muted,11,'center',false);label('w',px+pw+18,py+ph+3,colors.weight,18);label('α',px-2,py-20,colors.alpha,18);
 line(px,py,px+pw,py+ph,rgba(colors.muted,.7),1,[5,5]);
 ctx.beginPath();ctx.moveTo(px,py+ph);for(let k=0;k<=200;k++){const a=k/200,b=(1-a)/(1-a+a*Math.exp(gamma));ctx.lineTo(px+a*pw,py+(1-b)*ph);}ctx.lineTo(px+pw,py+ph);ctx.closePath();ctx.fillStyle=rgba(colors.alpha,.055);ctx.fill();
 ctx.beginPath();let previous;for(let k=0;k<=200;k++){const a=k/200,b=(1-a)/(1-a+a*Math.exp(gamma)),cx=px+a*pw,cy=py+(1-b)*ph;if(k===0)ctx.moveTo(cx,cy);else{ctx.lineTo(cx,cy);if(editable)registerPlotLine(previous.x,previous.y,cx,cy,'plot-gamma',k,'curve',px,pw);}previous={x:cx,y:cy};}ctx.strokeStyle=colors.alpha;ctx.lineWidth=3.2;ctx.stroke();
 fade(p,()=>{for(let j=0;j<params.n;j++){const vx=px+roundData.w[j]*pw,vy=py+(1-alpha[j])*ph,near=editable&&p===1?(drag?.kind==='w'&&drag.j===j?1:pointerPosition?smooth(clamp(1-Math.hypot(pointerPosition.x-vx,pointerPosition.y-py-ph)/28)):0):0,radius=mix(2.8,5.2,near);line(vx,py+ph,vx,vy,rgba(colors.weight,.45),.9,[2,4]);line(px,vy,vx,vy,rgba(colors.alpha,.5),.9,[2,4]);if(near>0)dot(vx,py+ph,rgba('#f6f0e3',near),radius+1.2);dot(vx,py+ph,colors.weight,radius);dot(px,vy,colors.alpha,2.8);dot(vx,vy,colors.alpha,3.1);
  if(editable&&p===1){registerPlotLine(vx,py+ph,vx,vy,'plot-w',j,'input',px,pw);registerPlotLine(px,vy,vx,vy,'plot-w',j,'output',px,pw);registerPlotLine(vx,vy,vx,vy,'plot-w',j,'point',px,pw);registerPlotLine(vx,py+ph,vx,py+ph,'plot-w',j,'input-point',px,pw);registerPlotLine(px,vy,px,vy,'plot-w',j,'output-point',px,pw);}
 }});
 });}
function drawMass(i,p,result,wg,layout=massColumns(wg)){const {home,large,gateAlpha,alpha,newM,etaM,eta}=layout;const maxM=roundData.massScale;
 if(i<3){const reveal=gateReveal(i,p);gateLinks(wg,gateAlpha,reveal.input,reveal.output);gatePlot(gammaAt(i,p),result.alpha,reveal.output,reveal.frame);column(gateAlpha,result.alpha,'α',colors.alpha,reveal.alpha);return;}
 if(i===3){const delay=params.fadeDuration,span=params.durations[i]-delay,progress=clamp((p*params.durations[i]-delay)/span),move=phase(progress,0,.3),flow=phase(progress,.3,.9),decay=phase(flow,.8,1),gateOut=fadeOut(i,p);gateLinks(layout.gateW,gateAlpha,1,1,gateOut);gatePlot(gammaAt(i,p),result.alpha,1,gateOut);column(blendGeometry(home,large,move),roundData.m,'m',colors.mass,1,maxM,'m',true);column(blendGeometry(gateAlpha,alpha,move),result.alpha,'α',colors.alpha);fade(fadeIn(i,p,delay+span*.3),()=>columnLinks(large,newM,colors.mass,flow));column(newM,roundData.m.map((m,j)=>mix(m,result.decayed[j],decay)),'',colors.mass,fadeIn(i,p,delay+span*.2),maxM,'',true);return;}
 if(i===4){const away=fadeOut(i,p,params.durations[i]*.5),flow=phase(p,.08,.48),addition=phase(flow,.8,1);column(large,roundData.m,'m',colors.mass,away,maxM,'m',true);column(alpha,result.alpha,'α',colors.alpha,away);fade(away,()=>columnLinks(large,newM,colors.mass));fade(fadeIn(i,p),()=>rightLinks(wg,newM,colors.weight,flow));column(newM,result.decayed.map((m,j)=>mix(m,result.mass[j],addition)),'',colors.mass,1,maxM,'',true);fade(1-away,()=>label('m',newM.x+newM.w/2,newM.y-27,colors.mass,25));return;}
 if(i===5){const move=etaMoveProgress(p),flow=fadeIn(i,p,params.fadeDuration+etaMoveSeconds),mg=blendGeometry(newM,etaM,move);fade(fadeOut(i,p),()=>rightLinks(layout.updateW,newM,colors.weight));column(mg,result.mass,'m',colors.mass,1,maxM,'m',true);fade(flow,()=>{columnLinks(etaM,eta,colors.mass,flow);rightLinks(wg,eta,colors.weight,flow);rateFraction(eta.x+eta.w/2);});column(eta,result.eta,'η',colors.eta,flow);return;}
 const move=i===6?phase(afterFadeProgress(i,p),0,.22):1,mg=blendGeometry(etaM,home,move);if(i===6)fade(fadeOut(i,p),()=>{columnLinks(etaM,eta,colors.mass);rightLinks(wg,eta,colors.weight);rateFraction(eta.x+eta.w/2);});if(move<1)column(mg,result.mass,'m',colors.mass,1,maxM,'m',true);
}
function vectorCell(g,j,result,{v=0,triangle=0,eta=0,etaOpacity=eta,update=0,ghost=0,fit=0,returning=0,context=1}={}){box(g.x,g.y,g.w,g.h,rgba(colors.state,.025),rgba(colors.state,.34));if(!g.moving)hitRegions.push({...g,kind:'s',j,source:'input'});
 // All endpoints share one affine transform, held steady during the update.
 const solo=vectorMap(g,[roundData.s[j]]),joint=vectorMap(g,[roundData.s[j],roundData.v]),final=vectorMap(g,[result.state[j]]),map=s=>lerpPoint(lerpPoint(solo(s),joint(s),fit),final(s),returning),o=map({x:0,y:0}),s=map(roundData.s[j]),target=map(roundData.v),u=map(result.state[j]),width=Math.min(2.3,g.w*.05);
 vectorAxes(g,o);fade(v*context,()=>arrow(o.x,o.y,target.x,target.y,rgba(colors.gold,.85),1,width*.8));
 fade(triangle*context,()=>line(s.x,s.y,target.x,target.y,rgba(colors.gold,.65),1,[3,3]));
 fade(ghost,()=>arrow(o.x,o.y,s.x,s.y,rgba(colors.state,.28),1,width));
 fade(etaOpacity*context,()=>{const end=lerpPoint(target,u,eta);arrow(s.x,s.y,end.x,end.y,colors.eta,1,width);});
 const current=lerpPoint(s,u,update);arrow(o.x,o.y,current.x,current.y,colors.state,1,width);
}
function drawState(i,p,result,wg=columnGeometry(sceneWidth-110,210,76,410),layout=massColumns(wg)){if(i<6)return;const home=columnGeometry(76,432,72,308),entry=i===6||i===8?afterFadeProgress(i,p):0,move=i===6?phase(entry,.24,.62):i===8?1-phase(entry,0,.9):1,exit=i===8?fadeOut(i,p):1;if(i===8&&move===0)return;
 const cells=rotatedSlotCells(home,layout.stateRow,move,layout,'s'),etaMove=i===6?move:1,etaCells=rotatedSlotCells(layout.eta,layout.etaRow,etaMove,layout,'eta');
 const turn=phase(move,.22,.8),etaTurn=phase(etaMove,.22,.8);fade(exit,()=>{label('η',mix(etaCells[0].x+etaCells[0].w/2,etaCells[0].x-28,etaTurn),mix(etaCells[0].y-27,etaCells[0].y+etaCells[0].h/2,etaTurn),colors.eta,25);etaCells.forEach((g,j)=>box(g.x,g.y,g.w,g.h,rgba(colors.eta,diagram.strength(result.eta[j])),rgba(colors.eta,.2)));});
 if(i<8&&etaMove===1&&exit===1)etaCells.forEach((g,j)=>hitRegions.push({...g,kind:'eta',j,source:'output'}));
 label('s',mix(cells[0].x+cells[0].w/2,cells[0].x-28,turn),mix(cells[0].y-27,cells[0].y+cells[0].h/2,turn),colors.state,25);
 const vIn=i===6?fadeIn(i,p):exit,vMove=i===6?vIn:1,vBox={...layout.vBox,x:mix(sceneWidth-layout.vBox.w-12,layout.vBox.x,vMove),y:mix(contentHeight+20,layout.vBox.y,vMove)};
 fade(vIn,()=>{ctx.save();ctx.beginPath();ctx.rect(0,0,sceneWidth,contentHeight);ctx.clip();box(vBox.x,vBox.y,vBox.w,vBox.h,rgba(colors.gold,.025),rgba(colors.gold,.3));miniVector(vBox.x,vBox.y,vBox.w,vBox.h,roundData.v,colors.gold);label('v',vBox.x+vBox.w/2,vBox.y-20,colors.gold,25);ctx.restore();});
 if(i<8&&vIn===1&&vMove===1)hitRegions.push({...vBox,kind:'v',j:0});
 const links=i===7?fadeIn(i,p,params.durations[i]*.3):i===8?exit:0;fade(links,()=>etaCells.forEach((g,j)=>arrow(g.x+g.w/2,g.y+g.h+8,cells[j].x+cells[j].w/2,cells[j].y-8,rgba(colors.eta,diagram.alpha.link),i===7?phase(p,.3,.54):1)));
 const copyProgress=i===6?phase(entry,.66,.98):0;
 for(let j=0;j<params.n;j++){const g={...cells[j],moving:cells[j].moving||i===8||i===6&&copyProgress<1||i===7&&(p>=.1&&fadeIn(i,p,params.durations[i]*.1)<1||p>=.48&&p<.97)};if(i===6){vectorCell(g,j,result,{v:copyProgress===1?1:0,fit:copyProgress});}else if(i===7){vectorCell(g,j,result,{v:1,triangle:fadeIn(i,p,params.durations[i]*.1),eta:phase(p,.48,.72),etaOpacity:fadeIn(i,p,params.durations[i]*.48),update:phase(p,.73,.97),ghost:fadeIn(i,p,params.durations[i]*.73),fit:1});}else{vectorCell(g,j,result,{v:1,triangle:1,eta:1,update:1,ghost:fadeOut(i,p,params.fadeDuration),fit:1,returning:phase(entry,0,.9),context:exit});}}
 if(i===6){const source=vectorMap(vBox,[roundData.v]),sourceOrigin=source({x:0,y:0}),sourceTip=source(roundData.v);
  // Keep copied vectors above the cells while they travel from the input.
  for(let j=0;j<params.n;j++){const travel=copyProgress;if(travel<=0||travel>=1)continue;const g=cells[j],target=vectorMap(g,[roundData.s[j],roundData.v]),origin=lerpPoint(sourceOrigin,target({x:0,y:0}),travel),tip=lerpPoint(sourceTip,target(roundData.v),travel),width=mix(2,Math.min(2.3,g.w*.05)*.8,travel);arrow(origin.x,origin.y,tip.x,tip.y,rgba(colors.gold,mix(1,.85,travel)),1,width);}
 }
}
function drawProgress(){const active=checkpoint??progressGroups.findIndex(group=>locationAt().i<group.end);progressGroups.forEach((group,index)=>{const stop=stageStop(index),start=startOf(group.start),end=startOf(stop.i)+params.durations[stop.i]*stop.p,button=$('gsu-progress').children[index];button.style.setProperty('--stage-progress',`${clamp((elapsed-start)/(end-start))*100}%`);button.setAttribute('aria-current',index===active?'step':'false');});}
function draw(){const {i,p}=locationAt(),gamma=gammaAt(i,p),result=compute(gamma);hitRegions=[];ctx.clearRect(0,0,sceneWidth,sceneHeight);drawProgress();ctx.save();ctx.translate(0,sceneOffset);
 // The canvas remains one continuous scene; only time changes its geometry.
 const layout=massColumns(columnGeometry(sceneWidth-110,210,76,410)),wg=i<3?layout.gateW:i===3?blendGeometry(layout.gateW,layout.updateW,phase(afterFadeProgress(i,p),.15,.3)):i===4?layout.updateW:i===5?blendGeometry(layout.updateW,layout.etaW,etaMoveProgress(p)):layout.etaW,wOpacity=i===0?fadeIn(i,p):i===6?fadeOut(i,p):1;
 drawMass(i,p,result,wg,layout);drawState(i,p,result,wg,layout);if(i<6||i===6&&wOpacity>0)column(wg,roundData.w,'w',colors.weight,wOpacity,1);
 const retained=retainedValues(result);if(i<3||i>6||i===6&&afterFadeProgress(i,p)>=.22){column(layout.home,retained.m,'m',colors.mass,1,roundData.massScale,'',true);registerColumn(layout.home,'m','retained');}if(i<6||i===8&&afterFadeProgress(i,p)>=.9)stateHome(retained.s);
 drawStrengthHandles();drawVectorEditor(result);ctx.restore();
 const pill=$('gamma-pill'),scale=canvas.clientWidth/sceneWidth,gammaScale=Math.min(1,scale/.65),position=clamp((gamma+9.9)/19.8)*100,centerX=(gateFrame.x+gateFrame.size/2)*scale;
 const topY=(inputRowY+sceneOffset)*scale,nearY=Math.max(topY+16*scale,(gateFrame.y+sceneOffset)*scale-65*gammaScale),lift=i<3?0:i===3?phase(p,0,.4):1,opacity=i>5?0:i===5?fadeOut(i,p):i<3?gateReveal(i,p).frame:1;
 const controlY=mix(nearY,topY,lift),editor=hoverVector?.g,editorRight=editor&&editor.y*scale<controlY-sceneOffset*scale+35&&(editor.y+editor.h)*scale>controlY-sceneOffset*scale-37?(editor.x+editor.w)*scale:0;
 const availableWidth=editorRight?2*(centerX-editorRight-30):gateFrame.size*scale;
 const gammaEditable=!window.ramnetCompactInteractions.matches&&i<5&&opacity===1&&!gammaInMotion();
 pill.style.left=centerX+'px';pill.style.top=controlY-17+'px';pill.style.width=Math.min(gateFrame.size*scale,availableWidth)/gammaScale+'px';pill.style.transform='translateX(-50%) scale('+gammaScale+')';pill.style.transformOrigin='50% 17px';pill.style.opacity=opacity;pill.style.pointerEvents=gammaEditable?'auto':'none';pill.inert=!gammaEditable;
 $('gamma-live').disabled=!gammaEditable;
 $('gamma-fill').style.left=Math.min(50,position)+'%';$('gamma-fill').style.width=Math.abs(position-50)+'%';$('gamma-symbol').style.left=position+'%';$('gamma-value').style.left=position+'%';$('gamma-value').textContent=(gamma>=0?'+':'')+gamma.toFixed(1);$('gamma-live').value=gamma;

}
function guideColor(base){const rgb=parseInt(base.slice(1),16);return '#'+[rgb>>16,(rgb>>8)&255,rgb&255].map(channel=>Math.round(channel*.85).toString(16).padStart(2,'0')).join('');}
function guideLine(x,y,dx,dy,color,width,opacity=1){ctx.save();ctx.lineCap='round';for(const [tint,stroke] of [['#f6f0e3',width+2],[color,width]]){const gradient=ctx.createLinearGradient(x-dx,y-dy,x+dx,y+dy);for(const [stop,alpha] of [[0,0],[.35,opacity],[.65,opacity],[1,0]])gradient.addColorStop(stop,rgba(tint,alpha));line(x-dx,y-dy,x+dx,y+dy,gradient,stroke);}ctx.restore();}
function drawStrengthHandles(){if(window.ramnetCompactInteractions.matches)return;for(const g of hitRegions){if(!['m','w','eta'].includes(g.kind))continue;
 const distance=pointerPosition?Math.hypot(Math.max(g.x-pointerPosition.x,0,pointerPosition.x-g.x-g.w),Math.max(g.y-pointerPosition.y,0,pointerPosition.y-g.y-g.h)):Infinity,active=drag&&drag.kind===g.kind&&drag.j===g.j&&drag.source===g.source,proximity=active?1:smooth(clamp(1-distance/28)),length=mix(Math.min(22,g.w*.5),g.w+30,proximity),x=g.x+g.w/2,y=g.y+g.h/2;
 const color=guideColor(colors[g.kind==='m'?'mass':g.kind==='w'?'weight':'eta']),radius=mix(1.8,g.kind==='w'?5.2:3.6,proximity);
 guideLine(x,y,length/2,0,color,mix(1,4,proximity),mix(.55,.72,proximity));dot(x,y,'#f6f0e3',radius+1.2);dot(x,y,color,radius);
}}
function registerColumn(g,kind,source){if(g.moving)return;for(let j=0;j<params.n;j++)hitRegions.push({x:g.x,y:g.cy(j)-g.cell/2,w:g.w,h:g.cell,kind,j,source});}
function cancelInteractionExit(){clearTimeout(hoverExitTimer);hoverExitTimer=null;hoverExitZone=null;}
function clearInteraction(){cancelInteractionExit();resumeAfterHover=false;hoverTarget=null;gammaDragging=false;if(drag&&canvas.hasPointerCapture(drag.pointerId))canvas.releasePointerCapture(drag.pointerId);drag=null;pointerPosition=null;hoverVector=null;checkpoint=null;canvas.style.cursor='default';}
function leaveInteraction(){
 cancelInteractionExit();hoverTarget=null;hoverVector=null;canvas.style.cursor='default';if(!resumeAfterHover)return;resumeAfterHover=false;checkpoint=null;
 if(elapsed>=total()&&params.loop)nextRound();
 playing=elapsed<total();lastFrame=0;playback();
}
function interactionBounds(target){
 if(target.element){const r=target.element.getBoundingClientRect(),pad=target.element.id==='gamma-pill'?22:0;return {x:r.left,y:r.top-pad,w:r.width,h:r.height+pad};}
 const hit=target.hit,g=!target.original&&hoverVector&&(hit.kind==='s'||hit.kind==='v')?hoverVector.g:hitRegions.find(h=>h.kind===hit.kind&&h.j===hit.j&&h.source===hit.source&&h.part===hit.part)??hit,r=canvas.getBoundingClientRect();
 return {x:r.left+g.x*r.width/sceneWidth,y:r.top+(g.y+sceneOffset)*r.height/sceneHeight,w:g.w*r.width/sceneWidth,h:g.h*r.height/sceneHeight};
}
function holdInteraction(target){
 cancelInteractionExit();target.anchor=interactionBounds(target);hoverTarget=target;
 resumeAfterHover=true;finishStage();
}
function insideInteraction(point){return hoverTarget&&[hoverTarget.anchor,interactionBounds(hoverTarget),...(hoverVector?.source==='retained'?[interactionBounds({hit:hoverVector.origin,original:true})]:[])].some(g=>contains({x:g.x-12,y:g.y-12,w:g.w+24,h:g.h+24},point));}
function closeVectorEditor(){if(!hoverVector)return;hoverVector=null;if(hoverTarget?.hit&&(hoverTarget.hit.kind==='s'||hoverTarget.hit.kind==='v'))hoverTarget=null;canvas.style.cursor='default';}
function queueInteractionExit(zone='interaction'){
 if(!resumeAfterHover||drag||gammaDragging||hoverExitZone===zone)return;
 cancelInteractionExit();hoverExitZone=zone;
 const delay=zone==='canvas'?params.canvasExitDelay:params.interactionExitDelay;
 if(delay<0)return;if(delay===0){leaveInteraction();draw();return;}
 hoverExitTimer=setTimeout(()=>{hoverExitTimer=null;if(!drag&&!gammaDragging){leaveInteraction();draw();}},delay*1000);
}
function updateInteractionHover(event){
 if(window.ramnetCompactInteractions.matches)return;
 pointerPosition=scenePoint(event);if(drag||gammaDragging)return;const point={x:event.clientX,y:event.clientY};
 const element=[$('gamma-pill'),$('p-gamma')?.closest('.control')].find(el=>el&&!el.querySelector('input').disabled&&!el.inert&&contains(interactionBounds({element:el}),point));
 const area=canvas.closest('.scene-wrap').getBoundingClientRect();
 if(!element&&!contains({x:area.left,y:area.top,w:area.width,h:area.height},point)){closeVectorEditor();queueInteractionExit('canvas');draw();return;}
 if(insideInteraction(point)){cancelInteractionExit();return;}
 closeVectorEditor();
 if(element){hoverVector=null;holdInteraction({element});draw();return;}
 const r=canvas.getBoundingClientRect(),onCanvas=contains({x:r.left,y:r.top,w:r.width,h:r.height},point),hit=onCanvas?hitAt(scenePoint(event)):null;
 if(hit){
  if(hit.kind==='s'||hit.kind==='v')showVectorEditor(hit);else hoverVector=null;
  holdInteraction({hit});canvas.style.cursor=hit.kind==='s'||hit.kind==='v'?'grab':hit.kind==='plot-gamma'?'ns-resize':'ew-resize';draw();return;
 }
 queueInteractionExit();canvas.style.cursor='default';
}
function finishStage(group=checkpoint??progressGroups.findIndex(g=>locationAt().i<g.end)){
 checkpoint=group;const {i,p}=stageStop(group);elapsed=startOf(i)+params.durations[i]*p;playing=false;playback();draw();
}
function scenePoint(event){const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*sceneWidth/rect.width,y:(event.clientY-rect.top)*sceneHeight/rect.height-sceneOffset};}
function contains(g,point){return point.x>=g.x&&point.x<=g.x+g.w&&point.y>=g.y&&point.y<=g.y+g.h;}
function segmentDistance(segment,point){const {x1,y1,x2,y2}=segment,dx=x2-x1,dy=y2-y1,t=dx||dy?clamp(((point.x-x1)*dx+(point.y-y1)*dy)/(dx*dx+dy*dy)):0;return Math.hypot(point.x-x1-t*dx,point.y-y1-t*dy);}
function hitAt(point){
 if(hoverVector&&contains(hoverVector.g,point))return {...hoverVector,vectorKind:vectorKindAt(point)};
 let nearest,best=Infinity;for(let k=hitRegions.length-1;k>=0;k--){const region=hitRegions[k];if(!contains(region,point))continue;if(!region.segment)return region;const distance=segmentDistance(region.segment,point);if(distance>6)continue;const score=distance-(region.part.includes('point')?8:0);if(score<best){best=score;nearest=region;}}
 return nearest??(hoverTarget?.hit&&!hoverTarget.hit.segment&&contains(hoverTarget.hit,point)?hoverTarget.hit:undefined);
}
function editableVector(kind,j,source){return source==='retained'?retainedValues().s[j]:kind==='v'?roundData.v:roundData.s[j];}
function showVectorEditor(hit){
 if(hoverVector?.kind===hit.kind&&hoverVector.j===hit.j&&hoverVector.source===hit.source)return;
 const x=hit.x+hit.w/2,y=hit.y+hit.h/2,retained=hit.kind==='s'&&hit.source==='retained',size=retained?230:Math.min(230,2*(x-8),2*(sceneWidth-x-8),2*(y-8),2*(contentHeight-y-8));
 const g=retained?{x:clamp(hit.x+hit.w+params.spacing/2,16,sceneWidth-size-16),y:clamp(y-size/2,16,contentHeight-size-16),w:size,h:size}:{x:x-size/2,y:y-size/2,w:size,h:size};
 hoverVector={kind:hit.kind,j:hit.j,source:hit.source,origin:hit,g,map:null};
 holdInteraction({hit});
}
function vectorKindAt(point){
 const h=hoverVector;if(h.source==='retained')return 's';if(h.kind==='v')return 'v';
 const s=h.map(roundData.s[h.j]),v=h.map(roundData.v);
 // Separate the cross arms when endpoints coincide so both vectors remain selectable.
 if(Math.hypot(s.x-v.x,s.y-v.y)<1)return Math.abs(point.x-v.x)>Math.abs(point.y-v.y)?'v':'s';
 return Math.hypot(point.x-v.x,point.y-v.y)<Math.hypot(point.x-s.x,point.y-s.y)?'v':'s';
}
function vectorDragGuide(tip,color){if(!pointerPosition)return;const proximity=smooth(clamp((48-Math.hypot(pointerPosition.x-tip.x,pointerPosition.y-tip.y))/28));if(!proximity)return;const reach=mix(22,32,proximity),tint=guideColor(color);guideLine(tip.x,tip.y,reach,0,tint,4.2,proximity*.72);guideLine(tip.x,tip.y,0,reach,tint,4.2,proximity*.72);}
function drawVectorEditor(result){if(!hoverVector)return;
 const h=hoverVector,g=h.g,color=h.kind==='s'?colors.state:colors.gold,value=editableVector(h.kind,h.j,h.source),retained=h.source==='retained',v=retained?value:roundData.v,{i,p}=locationAt(),update=retained||i<7?0:i===7?phase(p,.73,.97):1;
 const extent=Math.max(1,Math.abs(value.x)*1.25,Math.abs(value.y)*1.25,Math.abs(v.x)*1.25,Math.abs(v.y)*1.25);
 const map=drag?.map??vectorMap(g,[{x:-extent,y:-extent},{x:extent,y:extent}]);h.map=map;
 ctx.save();ctx.shadowColor=rgba(colors.ink,.12);ctx.shadowBlur=20;ctx.shadowOffsetY=5;box(g.x,g.y,g.w,g.h,colors.paper,rgba(color,.65));ctx.restore();
 box(g.x,g.y,g.w,g.h,rgba(color,.035),null);const o=map({x:0,y:0}),tip=map(value),target=map(v);vectorAxes(g,o);
 if(!retained)arrow(o.x,o.y,target.x,target.y,colors.gold,1,2);if(h.kind==='s'){
  arrow(o.x,o.y,tip.x,tip.y,rgba(colors.state,mix(1,.28,update)),1,2.5);
  if(update>0){const updated=map(lerpPoint(value,result.state[h.j],update));line(tip.x,tip.y,target.x,target.y,rgba(colors.gold,.45),1,[3,3]);arrow(tip.x,tip.y,updated.x,updated.y,colors.eta,1,1.5);arrow(o.x,o.y,updated.x,updated.y,colors.state,1,2.5);}
 }
 if(!retained)vectorDragGuide(target,colors.gold);if(h.kind==='s')vectorDragGuide(tip,colors.state);
}
function beginDrag(event){if(window.ramnetCompactInteractions.matches||event.button!==0)return;const point=scenePoint(event),hit=hitAt(point);pointerPosition=point;if(!hit)return;event.preventDefault();
 const isVector=hit.kind==='s'||hit.kind==='v';if(isVector){showVectorEditor(hit);draw();}
 const kind=isVector?hit.vectorKind??vectorKindAt(point):hit.kind==='plot-w'?'w':hit.kind==='plot-gamma'?'gamma':hit.kind;
 holdInteraction({hit});
 const result=compute(gammaOverride??roundData.gamma),j=hit.j;
 const massScale=roundData.massScale;
 drag={kind,j,source:hit.source,pointerId:event.pointerId,start:point,massScale,weights:[...roundData.w],plotSize:hit.plotSize};
 if(kind==='gamma'){drag.value=gammaOverride??roundData.gamma;drag.input=clamp((point.x-hit.plotX)/hit.plotSize,.001,.999);drag.alpha=(1-drag.input)/(1-drag.input+drag.input*Math.exp(drag.value));}
 else if(isVector){drag.map=hoverVector.map;drag.value={...editableVector(kind,j,hit.source)};}
 else drag.value=hit.source==='retained'?retainedValues(result).m[j]:kind==='eta'?result.eta[j]:kind==='w'?roundData.w[j]:hit.source==='output'?result.mass[j]:roundData.m[j];
 canvas.setPointerCapture(event.pointerId);canvas.style.cursor=isVector?'grabbing':kind==='gamma'?'ns-resize':'ew-resize';draw();
}
function moveDrag(point){const d=drag,j=d.j;if(d.kind==='w'){
  if(params.n===1){roundData.w[0]=1;return;}
  const value=clamp(d.weights[j]+(point.x-d.start.x)/(d.plotSize??220)),rest=d.weights.reduce((sum,w,k)=>sum+(k===j?0:w),0);
  roundData.w=d.weights.map((w,k)=>k===j?value:rest>0?w/rest*(1-value):(1-value)/(params.n-1));
 }else if(d.kind==='gamma'){
  const alpha=clamp(d.alpha-(point.y-d.start.y)/d.plotSize,1e-8,1-1e-8);gammaOverride=clamp(Math.log1p(-d.input)+Math.log1p(-alpha)-Math.log(d.input)-Math.log(alpha),-9.9,9.9);
 }else if(d.kind==='eta'){
  roundData.etaOverride[j]=clamp(d.value+(point.x-d.start.x)/220);
 }else if(d.kind==='m'){
  const value=Math.max(1e-6,d.value+(point.x-d.start.x)/180*d.massScale);if(d.source==='retained')roundData.retainedM[j]=value;else if(d.source==='output')roundData.massOverride[j]=value;else roundData.m[j]=value;
 }else{
  const o=d.map({x:0,y:0}),unit=d.map({x:1,y:1}),g=hoverVector.g,tip=d.map(d.value);
  const x=clamp(tip.x+point.x-d.start.x,g.x+12,g.x+g.w-12),y=clamp(tip.y+point.y-d.start.y,g.y+12,g.y+g.h-12);
  const value={x:(x-o.x)/(unit.x-o.x),y:(y-o.y)/(unit.y-o.y)};
  if(d.source==='retained')roundData.retainedS[j]=value;
  else if(d.kind==='v')roundData.v=value;
  else roundData.s[j]=value;
 }
}
canvas.addEventListener('pointerdown',beginDrag);
canvas.addEventListener('pointermove',event=>{if(drag){moveDrag(scenePoint(event));draw();}});
function endDrag(event){if(!drag||event.pointerId!==drag.pointerId)return;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(event.type==='pointercancel'){closeVectorEditor();queueInteractionExit();}else updateInteractionHover(event);canvas.style.cursor=hoverVector?'grab':'default';draw();}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
document.addEventListener('pointermove',updateInteractionHover);
canvas.closest('.scene-wrap').addEventListener('pointerleave',updateInteractionHover);
document.addEventListener('pointerleave',()=>{if(!drag&&!gammaDragging){closeVectorEditor();queueInteractionExit('canvas');draw();}});
document.addEventListener('pointerdown',event=>{const input=event.target.closest('#gamma-live,#p-gamma');if(!input||input.disabled)return;holdInteraction({element:input.id==='gamma-live'?$('gamma-pill'):input.closest('.control')});gammaDragging=true;},true);
document.addEventListener('pointerup',event=>{if(gammaDragging){gammaDragging=false;updateInteractionHover(event);}});
document.addEventListener('pointercancel',()=>{if(gammaDragging){gammaDragging=false;queueInteractionExit();}});
function resize(){const dpr=Math.min(window.devicePixelRatio||1,3);canvas.width=Math.round(canvas.clientWidth*dpr);canvas.height=Math.round(canvas.clientHeight*dpr);ctx.setTransform(canvas.width/sceneWidth,0,0,canvas.height/sceneHeight,0,0);draw();}
function playback(){ $('gsu-play').textContent=playing?'Ⅱ':'▶';$('gsu-play').setAttribute('aria-label',playing?'Pause':'Play');document.querySelectorAll('#gsu-progress [data-stage]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.stage)===checkpoint))); }
function seek(t){clearInteraction();elapsed=clamp(t,0,total());playing=false;playback();draw();}
function selectAction(i){seek(startOf(clamp(i,0,8))+.001);}
function frame(now){const delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(playing&&!document.hidden){elapsed+=delta*params.speed;if(elapsed>=total()){if(params.loop)nextRound();else{elapsed=total();playing=false;playback();}}}draw();requestAnimationFrame(frame);}
function applyStyle(){sceneHeight=Math.max(contentHeight,1200/params.aspectRatio);sceneOffset=(sceneHeight-contentHeight)/2;sceneWidth=sceneHeight*params.aspectRatio;canvas.style.aspectRatio=String(params.aspectRatio);const style=document.documentElement.style;style.setProperty('--radius',params.panelRadius+'px');style.setProperty('--space',params.spacing+'px');Object.assign(colors,params.colors);for(const [key,value] of Object.entries(colors))style.setProperty('--'+key,value);}
$('gamma-live').onpointerdown=()=>{if(!$('gamma-live').disabled)finishStage();};
$('gamma-live').oninput=e=>{if(e.target.disabled||locationAt().i>=5){draw();return;}const value=Number(e.target.value);finishStage();gammaOverride=value;draw();};
document.addEventListener('keydown',e=>{if(e.target.closest('input,select,button,summary,textarea')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();clearInteraction();playing=!playing;playback();}if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();seek(elapsed+(e.code==='ArrowLeft'?-.15:.15));}});
progressGroups.forEach((group,index)=>{const button=document.createElement('button');button.type='button';button.className='gsu-progress-step';button.style.setProperty('--stage-color',colors[group.color]);const label=document.createElement('span');label.textContent=group.name;button.append(label);button.dataset.stage=index;button.addEventListener('click',()=>{clearInteraction();finishStage(index);});$('gsu-progress').append(button);});
$('gsu-play').addEventListener('click',()=>{clearInteraction();playing=!playing;lastFrame=0;playback();draw();});
window.ramnetCompactInteractions.addEventListener('change',()=>{const resume=resumeAfterHover;clearInteraction();if(resume)playing=true;playback();draw();});
document.addEventListener('visibilitychange',()=>{lastFrame=0;});new ResizeObserver(resize).observe(canvas);document.body.getRootNode().host?.addEventListener('ramnet:fit',resize);initialize();scope.setCycleDuration?.(total()/params.speed);applyStyle();playback();resize();scope.onAutoplayStart?.(()=>{initialize();playing=true;lastFrame=0;playback();draw();});requestAnimationFrame(frame);
};
if (document.body.classList.contains('exhibit-gsu')) window.RamnetRuntime.mountStandalone('gsu');
