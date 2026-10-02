window.RamnetAnimations ??= {};
window.RamnetAnimations.product_softmax = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame} = scope;
const palette=window.RamnetPalette;
'use strict';
const diagram=window.ramnetDiagramTheme;
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const SECTION_NAMES={distribution:'Soft Radix Address',tree:'Multilevel Decision Tree',heatmap:'Joint Distribution',regroup:'Regroupable Address',waveform:'Waveform Modulation'};
const SECTIONS=Object.keys(SECTION_NAMES).filter(name=>$(name+'-page')&&$(name+'-card')&&$(name+'-tab'));
let config = {U:4,dp:4,factors:null,temperature:0.85,duration:15,sectionDelay:0.5,heatmapScanDuration:15,regroupDuration:15,waveformRevealDuration:3.5,waveformScanDuration:12,waveformHeight:96,waveformGap:48,waveformAddressGap:8,treeExpandDuration:1,treePruneDuration:1.5,treeHoldDuration:1.5,topK:8,cardWidth:138,cardGap:25,upperGap:100,lowerGap:108,barGap:30,factorAspect:1.4,outputAspect:1,interactionAspect:1.8,factorPadding:10,factorPlotHeight:73,barRadiusRatio:6,frameRadiusRatio:4.5,barRadius:1.2,frameRadius:6,radius:6,animationRadius:20,lineRadius:6,spacing:25,height:130,treeNodeWidth:16,treeNodeHeight:16,treeNodeRadius:8,treeParentGapRatio:1.5,outputScale:'auto',uiFontScale:100,diagramFontScale:100,colors:[diagram.colors.indigo,diagram.colors.purple,diagram.colors.green,diagram.colors.gold],outputColor:diagram.colors.sky};
let distributions = [], probabilities = [], groups = [], sourceNodes = [], routeNodes = [], addressNodes = [];
let bars = [], binSize = 1, maxGroup = 1, outputScaleMax = 1, total = 256, bits = 2;
let topBars = new Set();
let progress = 0, previousTimestamp = null, currentIndex = -1, activeAction = -1;
let outputBox, highlight, scanLine, outputRoute;
let addressGroup;
let viewState='animation',pageHovered=false,interactionRegion=null;
let lastOperation=null,resumeDelay=null;
let parameterTimer=null;
const parameterPointers=new Set(),PARAMETER_COOLDOWN_MS=1000;
let sectionSwitchAt = null, repeatSection = false;
let factorEditors = [];
let activeSection = 'distribution', treeLayers = [], treeOutputs = [], treeOutputGroup;
let pageOrder=[...SECTIONS],pageFlip=null;
let articleLayout=null;
let heatmapSources=[],heatmapSourceLabels=[],heatmapNodes=[],heatmapEdges=[];
let heatmapLayout,heatmapPoints,heatmapHover=null,heatmapLastFrame=0,heatmapTime=0;
const heatmapScales=[.9,.97,1.03,1.1];
const heatmapOrbit={radius:8,thetaRate:.075,phiRate:.09,phiMean:30*Math.PI/180,phiAmplitude:20*Math.PI/180};
const heatmapProjectionSize=measureHeatmapOrbit();
let regroupSources=[],regroupStrips,regroupPanels,regroupLinks=[],regroupAddressLabels;
let waveformRows=[],waveformBars=[],waveformScan,waveformReadout,waveformLayout;
let multiplyY = 285;
const chart = {x:56,width:888,bottom:513,height:130};
let actions = [];
function sectionDuration(section=activeSection) {
  if(section==='heatmap')return config.heatmapScanDuration*(config.U*config.dp+2)/(config.U*config.dp);
  if(section==='regroup')return config.regroupDuration;
  if(section==='waveform')return config.waveformRevealDuration+config.waveformScanDuration;
  return section==='tree'?config.U*(config.treeExpandDuration+config.treePruneDuration)+config.treeHoldDuration:config.duration;
}
function heatmapFrame() { return Math.min(config.U*config.dp,Math.floor(progress*(config.U*config.dp+2))-1); }
function heatmapProgress(frame) { return (frame+1)/(config.U*config.dp+2); }
function sectionCycleDuration(section) { return sectionDuration(section)+config.sectionDelay; }
function nextSection() {return SECTIONS[(SECTIONS.indexOf(activeSection)+1)%SECTIONS.length];}
function setViewState(next,{restart=false}={}) {
  // Every transition between the two active modes passes through rest.
  if(next!=='rest'&&viewState!=='rest'&&(next!==viewState||restart))setViewState('rest');
  if(viewState==='animation'&&next!=='animation') {
    resumeDelay=sectionSwitchAt===null?null:Math.max(0,sectionSwitchAt-performance.now());
    lastOperation=null;
  }
  if(next==='interaction')lastOperation='diagram';
  if(next===viewState&&!restart)return;
  viewState=next;sectionSwitchAt=null;previousTimestamp=null;currentIndex=-1;
  if(next==='animation') {
    if(restart){progress=0;repeatSection=false;}
    lastOperation=null;resumeDelay=null;
  }
  if(next!=='interaction'){interactionRegion=null;heatmapHover=null;}
  updatePlayback();
}
function resumeAnimation() {
  const operation=lastOperation,delay=resumeDelay;
  if(operation!==null)repeatSection=progress>1-1/sectionDuration();
  setViewState('animation');
  if(progress>=1)sectionSwitchAt=performance.now()+(operation===null&&delay!==null?delay:config.sectionDelay*1000);
  render();
}
function refreshViewState() {
  const resting=pageHovered||parameterTimer!==null||parameterPointers.size>0;
  const next=interactionRegion?'interaction':resting?'rest':'animation';
  if(next===viewState)return;
  if(next==='animation'){resumeAnimation();return;}
  setViewState(next);render();
}
function cancelParameterPause() {
  window.clearTimeout(parameterTimer);parameterTimer=null;parameterPointers.clear();
}
function scheduleParameterResume() {
  window.clearTimeout(parameterTimer);parameterTimer=null;
  if(parameterPointers.size)return;
  parameterTimer=window.setTimeout(()=>{
    parameterTimer=null;refreshViewState();
  },PARAMETER_COOLDOWN_MS);
}
function pauseForParameters() {
  interactionRegion=null;setViewState('rest');lastOperation='parameters';
  scheduleParameterResume();render();
}
function scenePoint(scene,event) {
  const point=scene.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
  return point.matrixTransform(scene.getScreenCTM().inverse());
}
function bindInteractionRegion(node,follow) {
  node.setAttribute('data-interaction-region','');
  let touchPointer=null;
  const enter=event=>{
    if(window.ramnetCompactInteractions.matches)return;
    cancelParameterPause();setViewState('interaction');interactionRegion=node;follow(event);
  };
  for(const type of ['pointerenter','pointermove'])node.addEventListener(type,event=>{
    if(event.pointerType==='mouse'||event.pointerId===touchPointer)enter(event);
  });
  node.addEventListener('pointerdown',event=>{
    if(window.ramnetCompactInteractions.matches)return;
    if(event.pointerType!=='mouse'){touchPointer=event.pointerId;node.setPointerCapture(event.pointerId);}
    enter(event);
  });
  node.addEventListener('pointerleave',event=>{
    if(event.pointerType==='mouse'&&interactionRegion===node){interactionRegion=null;refreshViewState();}
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])node.addEventListener(type,event=>{
    if(event.pointerId!==touchPointer&&type!=='pointercancel')return;
    touchPointer=null;
    if(interactionRegion===node){interactionRegion=null;refreshViewState();}
    if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);
  });
}

function bindFactorScan(node,scene,u,left,step,choices=config.dp) {
  node.dataset.scanFactor=u;node.dataset.scanChoices=choices;
  bindInteractionRegion(node,event=>{
    const index=indexAt(progress),stride=config.dp**u,current=Math.floor(index/stride)%choices;
    const selected=Math.max(0,Math.min(choices-1,Math.floor((scenePoint(scene,event).x-left)/step)));
    node.dataset.scanValue=selected;
    if(current!==selected)seekIndex(index+(selected-current)*stride);else render();
  });
}

function applyPaint(node,attrs) {
  for(const channel of ['fill','stroke']) {
    const role=node.getAttribute(`data-${channel}-role`);
    if(role&&attrs[channel]!==undefined)node.setAttribute(channel,attrs[channel]);
  }
  if((node.localName==='text'||node.localName==='tspan')&&attrs.fill)node.setAttribute('fill',diagram.text(attrs.fill));
  if(node.getAttribute('data-fill-role')==='bar') {
    if(attrs['fill-opacity']!==undefined)node.setAttribute('fill-opacity',attrs['fill-opacity']*diagram.alpha.strong);
    else if(!node.hasAttribute('fill-opacity'))node.setAttribute('fill-opacity',diagram.alpha.strong);
  }
  if(node.getAttribute('data-fill-role')==='background'&&node.getAttribute('data-stroke-role')==='frame') {
    node.setAttribute('fill-opacity',diagram.alpha.surface);
    node.setAttribute('stroke-opacity',diagram.alpha.border);
  }
}
function svg(tag,attrs={},parent=$('scene')) {
  const node = document.createElementNS(NS,tag);
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key==='fillRole'?'data-fill-role':key==='strokeRole'?'data-stroke-role':key,key==='font-size'?value*config.diagramFontScale/100:value);
  applyPaint(node,attrs);
  parent.appendChild(node);
  return node;
}
function label(value,x,y,attrs={},parent) {
  const node = svg('text',{x,y,'font-weight':600,...attrs},parent);
  node.textContent = value;
  return node;
}
function set(node,attrs) { for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);applyPaint(node,attrs); }
function shapeRadius(width,height,kind) {
  const side=Math.min(width,height);
  return Math.min(side/2,Math.max(config[kind+'Radius'],side*config[kind+'RadiusRatio']/100));
}
function factorSize(maxWidth,maxHeight=Infinity) {
  const width=Math.min(maxWidth,maxHeight*config.factorAspect);
  return {width,height:width/config.factorAspect};
}
function animationSize(scene,minHeight) {
  const page=scene.closest('.stage');
  const aspect=page.clientWidth/page.clientHeight;
  const height=Math.max(1000/aspect,minHeight),width=height*aspect;
  scene.setAttribute('viewBox',`0 0 ${width} ${height}`);
  return {width,height};
}
function factorLayout(x,y,width,height,labelsInside=false) {
  const padding=width*config.factorPadding/100,inset=height*config.factorPadding/100;
  const labelSpace=labelsInside?Math.max(24*config.diagramFontScale/100,height*.18):0;
  const baseline=y+height-inset-labelSpace;
  return {left:x+padding,right:x+width-padding,baseline,step:(width-padding*2)/config.dp,
    plotHeight:Math.min(height*config.factorPlotHeight/100,height-inset*2-labelSpace),
    labelY:Math.min(baseline+labelSpace*.8,y+height-inset-16*config.diagramFontScale/100*.35)};
}
function roundedRoute(points) {
  let path=`M ${points[0][0]} ${points[0][1]}`;
  for(let i=1;i<points.length-1;i++) {
    const [ax,ay]=points[i-1],[bx,by]=points[i],[cx,cy]=points[i+1];
    const before=Math.hypot(bx-ax,by-ay),after=Math.hypot(cx-bx,cy-by);
    if(before===0||after===0){path+=` L ${bx} ${by}`;continue;}
    const r=Math.min(config.lineRadius,before/2,after/2);
    path+=` L ${bx-(bx-ax)*r/before} ${by-(by-ay)*r/before} Q ${bx} ${by} ${bx+(cx-bx)*r/after} ${by+(cy-by)*r/after}`;
  }
  const end=points[points.length-1];
  return `${path} L ${end[0]} ${end[1]}`;
}
function binary(value) { return value.toString(2).padStart(bits,'0'); }
function digits(index) { return Array.from({length:config.U},(_,u)=>Math.floor(index/config.dp**u)%config.dp); }
function address(parts) { return parts.reduce((n,d,u)=>n+d*config.dp**u,0); }
function color(u) {
  return config.colors[u];
}
function colorHue(base) {
  const [r,g,b]=base.slice(1).match(/../g).map(value=>parseInt(value,16)/255);
  const max=Math.max(r,g,b),delta=max-Math.min(r,g,b);
  return delta?60*(max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4):0;
}
function outputColor() {
  return config.outputColor;
}
function probabilityAppearance(base,strength) {
  const weight=palette.weight(strength,base);
  if(activeSection==='heatmap') {
    const hue=colorHue(base),range=palette.ranges.jointWeight;
    return {fill:`hsl(${hue} ${palette.scale(range.saturation,weight)}% ${palette.scale(range.lightness,weight)}%)`,
      'fill-opacity':palette.scale(range.opacity,weight)};
  }
  // Tint and alpha multiply: split the contrast equally between them.
  const range=palette.ranges.slotWeight,opacity=palette.scale(range,weight),darken=range.darken;
  const paper=$(activeSection+'-page').style.getPropertyValue('--page-shade');
  const channels=[1,3,5].map(offset=>{
    const background=parseInt(paper.slice(offset,offset+2),16);
    return Math.round(background+(parseInt(base.slice(offset,offset+2),16)*darken-background)*opacity);
  });
  return {fill:`rgb(${channels.join(' ')})`,'fill-opacity':opacity};
}
function number(value) { return value===0?'0':value>=0.001 ? value.toFixed(4) : value.toExponential(2); }
function probabilityCeiling(value) {
  const unit=10**Math.floor(Math.log10(value));
  return Math.min(1,[1,2,2.5,5,10].find(step=>step*unit>=value)*unit);
}
function notify(){}
function generate() {
  bits=Math.log2(config.dp); total=config.dp**config.U;
  distributions=config.factors?config.factors.map(row=>[...row]):Array.from({length:config.U},()=>{
    const logits=Array.from({length:config.dp},()=>Math.random()*2.7);
    const max=Math.max(...logits),exp=logits.map(v=>Math.exp((v-max)/config.temperature));
    const sum=exp.reduce((a,b)=>a+b,0);
    return exp.map(v=>v/sum);
  });
  config.factors=distributions.map(row=>[...row]);
  probabilities=[1];
  for (let u=config.U-1;u>=0;u--) probabilities=probabilities.flatMap(p=>distributions[u].map(q=>p*q));
  // Large distributions use exact probability mass per contiguous address bin.
  binSize=Math.max(1,total/512);
  groups=Array.from({length:Math.min(total,512)},(_,i)=>{
    let sum=0;for(let j=i*binSize;j<(i+1)*binSize;j++)sum+=probabilities[j];return sum;
  });
  maxGroup=groups.reduce((a,b)=>Math.max(a,b),0);
}
function updateFactorEditor(u) {
  const editor=factorEditors[u],row=distributions[u];
  let boundary=0;
  row.forEach((p,d)=>{
    editor.segments[d].style.width=`${p*100}%`;
    editor.segments[d].style.opacity=.25+.75*p;
    editor.values[d].textContent=`${(p*100).toFixed(1)}%`;
    for(const control of [editor.segments[d],editor.cells[d]]) {
      control.setAttribute('aria-valuenow',(p*100).toFixed(4));
      control.setAttribute('aria-valuetext',`${binary(d)}: ${(p*100).toFixed(2)}%`);
    }
    const left=boundary;boundary+=p;
    if(d<config.dp-1) {
      const handle=editor.handles[d];
      handle.style.left=`${boundary*100}%`;
      handle.setAttribute('aria-valuemin',(left*100).toFixed(4));
      handle.setAttribute('aria-valuemax',((boundary+row[d+1])*100).toFixed(4));
      handle.setAttribute('aria-valuenow',(boundary*100).toFixed(4));
      handle.setAttribute('aria-valuetext',`${binary(d)}: ${(p*100).toFixed(2)}%，${binary(d+1)}: ${(row[d+1]*100).toFixed(2)}%`);
    }
  });
}
function moveFactorBoundary(u,d,position) {
  const row=[...config.factors[u]],left=row.slice(0,d).reduce((a,b)=>a+b,0),right=left+row[d]+row[d+1];
  const boundary=Math.max(left,Math.min(right,position));
  // Only the two adjacent segments exchange mass; all other probabilities stay fixed.
  row[d]=boundary-left;row[d+1]=right-boundary;
  config.factors[u]=row;
  pauseForParameters();
  generate();updateFactorEditor(u);buildScene();
}
function setFactorShare(u,d,value,source=config.factors[u]) {
  const share=Math.max(0,Math.min(1,value)),remaining=source.reduce((sum,p,i)=>sum+(i===d?0:p),0);
  config.factors[u]=source.map((p,i)=>i===d?share:(1-share)*(remaining?p/remaining:1/(config.dp-1)));
  pauseForParameters();
  generate();updateFactorEditor(u);buildScene();
}
function bindControlHint(control,show,hide) {
  control.addEventListener('pointerenter',show);
  control.addEventListener('focus',show);
  control.addEventListener('pointerdown',show);
  control.addEventListener('pointerleave',()=>{
    if(!control.matches(':active,:focus-visible')&&!control.classList.contains('dragging'))hide();
  });
  control.addEventListener('blur',()=>{if(!control.matches(':hover'))hide();});
  for(const type of ['pointerup','lostpointercapture'])control.addEventListener(type,()=>{
    if(!control.matches(':hover,:focus-visible'))hide();
  });
  control.addEventListener('pointercancel',hide);
}
function buildFactorEditors() {
  $('factor-editors').replaceChildren();factorEditors=[];
  for(let u=config.U-1;u>=0;u--) {
    const card=document.createElement('div');card.className='factor-editor';card.style.setProperty('--factor-color',color(u));card.style.setProperty('--factor-ink',diagram.text(color(u)));
    const rail=document.createElement('div');rail.className='factor-rail';
    const segments=document.createElement('div');segments.className='factor-segments';rail.append(segments);
    const values=document.createElement('div');values.className='factor-values';values.setAttribute('aria-hidden','true');
    const editor={segments:[],handles:[],values:[],cells:[]};factorEditors[u]=editor;
    const showValues=(...indices)=>editor.cells.forEach((cell,d)=>{cell.hidden=!indices.includes(d);});
    for(let d=0;d<config.dp;d++) {
      const segment=document.createElement('div');segment.className='factor-segment';segments.append(segment);editor.segments.push(segment);
      const cell=document.createElement('div');cell.className='factor-value';cell.hidden=true;
      const index=document.createElement('span');index.textContent=binary(d);
      const value=document.createElement('output');cell.append(index,value);values.append(cell);editor.values.push(value);
      editor.cells.push(cell);
      bindControlHint(segment,()=>showValues(d),()=>showValues());
      {
        const control=segment;
        control.tabIndex=0;control.setAttribute('role','slider');control.setAttribute('aria-orientation','vertical');
        control.setAttribute('aria-label',`Factor ${u}, share of ${binary(d)}`);control.setAttribute('aria-valuemin','0');control.setAttribute('aria-valuemax','100');
        let gesture=null;
        control.addEventListener('pointerdown',event=>{
          if(event.button!==0||gesture)return;
          event.preventDefault();control.focus({preventScroll:true});control.setPointerCapture(event.pointerId);
          gesture={pointerId:event.pointerId,x:event.clientX,y:event.clientY,source:[...config.factors[u]],dragged:false};
          control.classList.add('dragging');
        });
        control.addEventListener('pointermove',event=>{
          if(!gesture||event.pointerId!==gesture.pointerId)return;
          if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>=4)gesture.dragged=true;
          if(gesture.dragged)setFactorShare(u,d,gesture.source[d]+(gesture.y-event.clientY)/180,gesture.source);
        });
        for(const type of ['pointerup','pointercancel','lostpointercapture'])control.addEventListener(type,event=>{
          if(!gesture||event.pointerId!==gesture.pointerId)return;
          if(type==='pointerup'&&!gesture.dragged)setFactorShare(u,d,gesture.source[d]+.05,gesture.source);
          gesture=null;control.classList.remove('dragging');
          if(control.hasPointerCapture(event.pointerId))control.releasePointerCapture(event.pointerId);
        });
        control.addEventListener('keydown',event=>{
          if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;
          showValues(d);
          event.preventDefault();event.stopPropagation();
          const step=event.shiftKey ? .001 : .01,share=config.factors[u][d];
          setFactorShare(u,d,event.key==='Home'?0:event.key==='End'?1:share+(['Enter',' '].includes(event.key) ? .05 : ['ArrowUp','ArrowRight'].includes(event.key)?step:-step));
        });
      }
      if(d===config.dp-1)continue;
      const handle=document.createElement('div');handle.className='factor-divider';handle.tabIndex=0;handle.setAttribute('role','slider');handle.setAttribute('aria-orientation','horizontal');
      handle.setAttribute('aria-label',`Factor ${u}, boundary between ${binary(d)} and ${binary(d+1)}`);
      bindControlHint(handle,()=>showValues(d,d+1),()=>showValues());
      let pointer=null;
      const move=event=>{const bounds=rail.getBoundingClientRect();moveFactorBoundary(u,d,(event.clientX-bounds.left)/bounds.width);};
      handle.addEventListener('pointerdown',event=>{
        if(event.button!==0||pointer!==null)return;
        event.preventDefault();pointer=event.pointerId;handle.focus({preventScroll:true});handle.setPointerCapture(pointer);handle.classList.add('dragging');move(event);
      });
      handle.addEventListener('pointermove',event=>{if(event.pointerId===pointer)move(event);});
      for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,event=>{
        if(event.pointerId!==pointer)return;
        pointer=null;handle.classList.remove('dragging');
        if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
      });
      handle.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
        showValues(d,d+1);
        event.preventDefault();event.stopPropagation();
        const row=config.factors[u],position=row.slice(0,d+1).reduce((a,b)=>a+b,0),step=event.shiftKey ? .001 : .005;
        moveFactorBoundary(u,d,event.key==='Home'?0:event.key==='End'?1:position+(['ArrowRight','ArrowUp'].includes(event.key)?step:-step));
      });
      rail.append(handle);editor.handles.push(handle);
    }
    card.append(rail,values);$('factor-editors').append(card);updateFactorEditor(u);
  }
}
function buildScene() {
  interactionRegion=null;
  if(viewState==='interaction')setViewState('rest');
  if(activeSection==='tree')buildTreeScene();else if(activeSection==='heatmap')buildHeatmapScene();else if(activeSection==='regroup')buildRegroupScene();else if(activeSection==='waveform')buildWaveformScene();else buildDistributionScene();
}
function buildDistributionScene() {
  const scene=$('scene'); scene.replaceChildren();
  const cardY=85,cardHeight=factorSize(config.cardWidth).height;
  chart.height=config.height*config.outputAspect;
  chart.plotHeight=chart.height*(1-config.factorPadding/100);chart.inset=chart.height*.05;
  const extraHeight=chart.height-120+cardHeight-120+config.upperGap-80+config.lowerGap-108;
  const {width:sceneWidth,height:sceneHeight}=animationSize(scene,590+extraHeight);
  chart.width=sceneWidth-112;chart.bottom=sceneHeight-95;
  const gapSpace=chart.bottom-chart.height-cardY-cardHeight;
  multiplyY=cardY+cardHeight+gapSpace*config.upperGap/(config.upperGap+config.lowerGap);
  sourceNodes=[];routeNodes=[];addressNodes=[];bars=[];
  topBars=new Set(Array.from(groups.keys()).sort((a,b)=>groups[b]-groups[a]||a-b).slice(0,config.topK));
  const defs=svg('defs');
  for(let u=0;u<=config.U;u++) {
    const marker=svg('marker',{id:`arrow-${u}`,viewBox:'0 0 8 8',refX:8,refY:4,markerWidth:7,markerHeight:7,markerUnits:'userSpaceOnUse',orient:'auto'},defs);
    svg('path',{d:'M 0 0 L 8 4 L 0 8 Z',fillRole:'arrow',fill:u===config.U?outputColor():color(u)},marker);
  }
  const groupWidth=config.cardWidth;
  const groupStart=(sceneWidth-config.U*groupWidth-(config.U-1)*config.cardGap)/2;
  const paths=svg('g',{'pointer-events':'none'});
  for(let u=config.U-1;u>=0;u--) {
    const x=groupStart+(config.U-1-u)*(groupWidth+config.cardGap),cx=x+groupWidth/2,c=color(u);
    const route=svg('path',{fill:'none',strokeRole:'arrow',stroke:c,'stroke-width':1.7,'stroke-linecap':'round',opacity:0.78,'marker-end':`url(#arrow-${u})`},paths);
    routeNodes[u]=route;
    const card=svg('g');
    svg('rect',{x,y:cardY,width:groupWidth,height:cardHeight,rx:shapeRadius(groupWidth,cardHeight,'frame'),fillRole:'background',fill:c,'fill-opacity':0.045,strokeRole:'frame',stroke:c,'stroke-opacity':diagram.alpha.border,'stroke-width':1},card);
    const layout=factorLayout(x,cardY,groupWidth,cardHeight),{baseline:sourceBaseline,step,plotHeight}=layout;
    const compactLabels=step<bits*16*config.diagramFontScale/100*.6+4;
    for(const tick of [.5,1])svg('line',{x1:layout.left,y1:sourceBaseline-tick*plotHeight,x2:layout.right,y2:sourceBaseline-tick*plotHeight,strokeRole:'frame',stroke:c,'stroke-opacity':0.16,'stroke-dasharray':'2 4'},card);
    const row=[];
    for(let d=0;d<config.dp;d++) {
      const bx=layout.left+d*step+step*config.barGap/200,bw=step*(1-config.barGap/100),bh=distributions[u][d]*plotHeight;
      const tag=label(binary(d),compactLabels?cx:layout.left+(d+.5)*step,76,{'text-anchor':'middle','font-size':16,fill:palette.neutral(6)},card);
      const bar=svg('rect',{x:bx,y:sourceBaseline-bh,width:bw,height:bh,rx:shapeRadius(bw,bh,'bar'),fillRole:'bar',fill:c,'fill-opacity':0.4,class:'source-bar',tabindex:0,role:'button','aria-label':`Factor ${u}, ${binary(d)}, probability ${number(distributions[u][d])}`},card);
      const choose=()=>{const parts=digits(indexAt(progress));parts[u]=d;seekIndex(address(parts));};
      bar.addEventListener('click',choose);
      bar.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});
      row.push({bar,tag,compactLabels});
    }
    svg('line',{x1:layout.left,y1:sourceBaseline,x2:layout.right,y2:sourceBaseline,strokeRole:'frame',stroke:c,'stroke-opacity':0.2},card);
    const factorHit=svg('rect',{x,y:cardY,width:groupWidth,height:cardHeight,fill:'transparent',style:'cursor:pointer'},card);
    bindFactorScan(factorHit,scene,u,layout.left,step);
    sourceNodes[u]={row,center:cx,arrowY:cardY+cardHeight+8};
  }
  scene.appendChild(paths);
  const multiplyX=sceneWidth/2;
  svg('circle',{cx:multiplyX,cy:multiplyY,r:21,fill:'none',stroke:palette.neutral(9),'stroke-width':1.2});
  svg('path',{d:`M${multiplyX-7} ${multiplyY-7}l14 14m0-14-14 14`,fill:'none',stroke:palette.neutral(3),'stroke-width':1.6,'stroke-linecap':'round'});
  outputBox=svg('rect',{x:chart.x,y:chart.bottom-chart.height-chart.inset,width:chart.width,height:chart.height+chart.inset,rx:shapeRadius(chart.width,chart.height+chart.inset,'frame'),fillRole:'background',fill:outputColor(),'fill-opacity':0.045,strokeRole:'frame',stroke:outputColor(),'stroke-opacity':diagram.alpha.border});
  outputScaleMax=config.outputScale==='unit'?1:probabilityCeiling(maxGroup);
  for(const fraction of [.5,1]) {
    const y=chart.bottom-fraction*chart.plotHeight;
    svg('line',{x1:chart.x,y1:y,x2:chart.x+chart.width,y2:y,strokeRole:'frame',stroke:outputColor(),'stroke-opacity':0.2,'stroke-dasharray':'3 5'});
  }
  const step=chart.width/groups.length;
  const barLayer=svg('g',{'pointer-events':'none'});
  for(let i=0;i<groups.length;i++) {
    const bh=groups[i]/outputScaleMax*chart.plotHeight,bw=step*(1-config.barGap/100);
    bars.push(svg('rect',{x:chart.x+i*step+step*config.barGap/200,y:chart.bottom-bh,width:bw,height:bh,rx:shapeRadius(bw,bh,'bar'),fillRole:'bar',fill:outputColor(),'fill-opacity':topBars.has(i)?0.65:0.23},barLayer));
  }
  svg('line',{x1:chart.x,y1:chart.bottom,x2:chart.x+chart.width,y2:chart.bottom,strokeRole:'frame',stroke:outputColor(),'stroke-opacity':0.23});
  highlight=svg('rect',{y:chart.bottom-chart.height+chart.inset,width:Math.max(2,step),height:chart.height+chart.inset,rx:shapeRadius(Math.max(2,step),chart.height+chart.inset,'bar'),fillRole:'background',fill:outputColor(),'fill-opacity':0.09,'pointer-events':'none'});
  scanLine=svg('line',{y1:chart.bottom+4,y2:chart.bottom+27,strokeRole:'frame',stroke:outputColor(),'stroke-width':1.2,'stroke-opacity':0.5,'stroke-dasharray':'2 4'});
  outputRoute=svg('path',{fill:'none',strokeRole:'arrow',stroke:outputColor(),'stroke-width':1.6,'stroke-opacity':0.65,'marker-end':`url(#arrow-${config.U})`});
  const hit=svg('rect',{x:chart.x,y:chart.bottom-chart.height-chart.inset,width:chart.width,height:chart.height+chart.inset+13,fill:'transparent',style:'cursor:crosshair',role:'presentation'});
  bindInteractionRegion(hit,event=>{
    const local=scenePoint(scene,event);
    seekIndex(Math.floor((local.x-chart.x)/chart.width*total));
  });
  addressGroup=svg('g',{'pointer-events':'none'});
  const addressText=label('',0,0,{'text-anchor':'middle','font-size':20,'letter-spacing':0.5},addressGroup);
  for(let u=config.U-1;u>=0;u--) {
    addressNodes[u]=svg('tspan',{fill:color(u)},addressText);
  }
  currentIndex=-1;render();
}
function treeCurve(x1,y1,x2,y2) {
  const middle=(y1+y2)/2;
  return `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
}
function buildTreeScene() {
  const scene=$('tree-scene');scene.replaceChildren();treeLayers=[];treeOutputs=[];
  const {width:fw,height:fh}=factorSize(config.cardWidth),fx=48;
  const left=fx+fw+52,rootY=54,baseRowGap=Math.max(100+config.upperGap/4,fh+20,config.treeNodeHeight+50);
  const baseOutputY=rootY+config.U*baseRowGap+24+config.lowerGap/2,minHeight=Math.max(baseOutputY+config.treeNodeHeight/2+60,rootY+config.U*baseRowGap+fh/2+22);
  const {width:sceneWidth,height}=animationSize(scene,minHeight),extra=height-minHeight;
  const width=sceneWidth-48-left,rowGap=baseRowGap+extra/(config.U+1),outputY=baseOutputY+extra;
  const defs=svg('defs',{},scene);
  const root={slot:0,p:1,x:left+width/2,y:rootY,h:20};
  svg('circle',{cx:root.x,cy:root.y,r:10,fillRole:'bar',fill:palette.neutral(10),strokeRole:'frame',stroke:palette.neutral(5),'stroke-width':1.5},scene);
  let beam=[root];
  for(let depth=0;depth<config.U;depth++) {
    const u=config.U-1-depth,y=rootY+(depth+1)*rowGap,c=color(u);
    const nodes=beam.flatMap(parent=>distributions[u].map((p,code)=>({parent,code,p:parent.p*p,slot:parent.slot*config.dp+code})));
    const winners=new Set([...nodes].sort((a,b)=>b.p-a.p||a.slot-b.slot).slice(0,config.topK));
    const max=Math.max(...nodes.map(node=>node.p)),step=width/nodes.length;
    const candidateScale=Math.min(1,step*.64/config.treeNodeWidth);
    const survivors=nodes.filter(node=>winners.has(node)),siblingGap=Math.max(16,64-config.treeNodeWidth);
    const gaps=survivors.map((node,i)=>i?siblingGap*(node.parent!==survivors[i-1].parent?config.treeParentGapRatio:1):0);
    const gapTotal=gaps.reduce((sum,gap)=>sum+gap,0);
    const gapScale=gapTotal?Math.min(1,(width-survivors.length*config.treeNodeWidth)/gapTotal):1;
    const span=(survivors.length-1)*config.treeNodeWidth+gapTotal*gapScale;
    let survivorX=left+(width-span)/2;
    survivors.forEach((node,i)=>{
      if(i)survivorX+=config.treeNodeWidth+gaps[i]*gapScale;
      node.x=survivorX;
    });
    const clipTop=rootY+depth*rowGap+beam[0].h/2,revealHeight=y+config.treeNodeHeight/2+4-clipTop;
    const clip=svg('clipPath',{id:`tree-reveal-${depth}`,clipPathUnits:'userSpaceOnUse'},defs);
    const revealClip=svg('rect',{x:left-12,y:clipTop,width:width+24,height:0},clip);
    const layer=svg('g',{'clip-path':`url(#tree-reveal-${depth})`},scene);
    svg('line',{x1:left,y1:y,x2:left+width,y2:y,strokeRole:'frame',stroke:c,'stroke-opacity':.09,'stroke-dasharray':'2 5'},layer);
    const edges=svg('g',{},layer),circles=svg('g',{},layer);
    nodes.forEach((node,i)=>{
      node.candidateX=left+(i+.5)*step;node.y=y;node.keep=winners.has(node);node.strength=max?node.p/max:0;
      if(!node.keep)node.x=node.candidateX;
      node.candidateScale=candidateScale;node.w=config.treeNodeWidth;node.h=config.treeNodeHeight;
      node.edge=svg('path',{d:treeCurve(node.parent.x,node.parent.y+node.parent.h/2+3,node.candidateX,y-node.h*candidateScale/2-3),fill:'none',strokeRole:'arrow',stroke:c,'stroke-width':1.1},edges);
      node.group=svg('g',{transform:`translate(${node.candidateX} ${y})`},circles);
      node.shape=svg('rect',{x:-node.w/2,y:-node.h/2,width:node.w,height:node.h,rx:Math.min(config.treeNodeRadius,node.w/2,node.h/2),fillRole:'bar',fill:c,'fill-opacity':diagram.strength(node.strength,c),strokeRole:'frame',stroke:c,'stroke-width':1.1},node.group);
      if(!node.keep) {
        const size=Math.max(3,Math.min(7,Math.min(node.w,node.h)*candidateScale*.35)),d=`M${-size} ${-size}L${size} ${size}M${size} ${-size}L${-size} ${size}`;
        node.cross=svg('g',{opacity:0},node.group);
        svg('path',{d,fill:'none',stroke:palette.color('paper'),'stroke-width':3.5,'stroke-linecap':'round'},node.cross);
        svg('path',{d,fill:'none',stroke:diagram.colors.red,'stroke-width':1.8,'stroke-linecap':'round'},node.cross);
      }
    });
    const factor=svg('g',{},scene),fy=y-fh/2,layout=factorLayout(fx,fy,fw,fh,true),{baseline,step:factorStep,plotHeight}=layout;
    svg('rect',{x:fx,y:fy,width:fw,height:fh,rx:shapeRadius(fw,fh,'frame'),fillRole:'background',fill:c,'fill-opacity':.055,strokeRole:'frame',stroke:c,'stroke-opacity':diagram.alpha.border},factor);
    const factorBars=[];
    distributions[u].forEach((p,d)=>{
      const bw=factorStep*(1-config.barGap/100),bx=layout.left+d*factorStep+(factorStep-bw)/2,bh=p*plotHeight;
      factorBars.push(svg('rect',{x:bx,y:baseline-bh,width:bw,height:bh,rx:shapeRadius(bw,bh,'bar'),fillRole:'bar',fill:c,'fill-opacity':.55},factor));
      if(factorStep>=24*config.diagramFontScale/100)label(binary(d),bx+bw/2,layout.labelY,{'text-anchor':'middle','font-size':16,fill:c},factor);
    });
    svg('line',{x1:layout.left,y1:baseline,x2:layout.right,y2:baseline,strokeRole:'frame',stroke:c,'stroke-opacity':.2},factor);
    const factorArrow=svg('path',{d:`M${fx+fw+12} ${y}H${fx+fw+30}m-5-4 5 4-5 4`,fill:'none',strokeRole:'arrow',stroke:c,'stroke-width':1.2,opacity:0},factor);
    treeLayers.push({nodes,layer,revealClip,revealHeight,factor,factorBars,factorArrow,factorHalfHeight:fh/2,u});
    beam=nodes.filter(node=>node.keep);
  }
  const max=Math.max(...beam.map(node=>node.p)),output=svg('g',{},scene);
  beam.forEach((node,i)=>{
    const x=left+(i+.5)*width/beam.length;
    svg('path',{d:treeCurve(node.x,node.y+node.h/2+3,x,outputY-node.h/2-3),fill:'none',strokeRole:'arrow',stroke:outputColor(),'stroke-width':1.5,'stroke-opacity':.55},output);
    svg('rect',{x:x-node.w/2,y:outputY-node.h/2,width:node.w,height:node.h,rx:Math.min(config.treeNodeRadius,node.w/2,node.h/2),fillRole:'bar',fill:outputColor(),'fill-opacity':diagram.strength(max?node.p/max:0,outputColor()),strokeRole:'frame',stroke:outputColor(),'stroke-width':1.5},output);
    if(width/beam.length>=bits*config.U*16*config.diagramFontScale/100*.6+6) {
      const text=label('',x,outputY+node.h/2+23,{'text-anchor':'middle','font-size':16},output);
      const parts=digits(node.slot);
      for(let u=config.U-1;u>=0;u--)svg('tspan',{fill:color(u)},text).textContent=binary(parts[u]);
    }
    treeOutputs.push(node);
  });
  treeOutputGroup=output;
  const resultTop=rootY+config.U*rowGap+config.treeNodeHeight/2+4;
  const hit=svg('rect',{x:32,y:rootY-20,width:sceneWidth-64,height:height-rootY+20,fill:'transparent',style:'cursor:ns-resize',role:'presentation'},scene);
  const follow=event=>{
    const local=scenePoint(scene,event),y=local.y;
    const depth=Math.max(0,Math.min(config.U-1,Math.round((y-rootY)/rowGap)-1));
    const nearFactor=local.x>=fx-20&&local.x<=fx+fw+20&&Math.abs(y-(rootY+(depth+1)*rowGap))<=treeLayers[depth].factorHalfHeight;
    const outputAction=actions[config.U*2];
    if(nearFactor) {
      const start=actions[depth*2].start,end=actions[depth*2+1].end;
      const position=(y-(rootY+(depth+1)*rowGap-treeLayers[depth].factorHalfHeight))/(treeLayers[depth].factorHalfHeight*2);
      progress=start+(end-start)*Math.max(0,Math.min(1,position));
    } else {
      progress=y>=resultTop?(outputAction.start+outputAction.end)/2:Math.max(0,(y-rootY)/(resultTop-rootY))*outputAction.start;
    }
    render();
  };
  bindInteractionRegion(hit,follow);
  render();
}
function buildCompactFactor(scene,u,x,y,width,height) {
  const c=color(u),group=svg('g',{transform:'translate('+x+' '+y+')'},scene);
  const bars=[],labels=[];
  svg('rect',{width,height,rx:shapeRadius(width,height,'frame'),fillRole:'background',fill:c,'fill-opacity':.055,strokeRole:'frame',stroke:c,'stroke-opacity':diagram.alpha.border},group);
  const fontScale=config.diagramFontScale/100;
  const layout=factorLayout(0,0,width,height,true),compact=layout.step<bits*16*fontScale*.6+4;
  distributions[u].forEach((p,code)=>{
    const barWidth=layout.step*(1-config.barGap/100),barHeight=p*layout.plotHeight,barX=layout.left+(code+.5)*layout.step-barWidth/2;
    bars.push(svg('rect',{x:barX,y:layout.baseline-barHeight,width:barWidth,height:barHeight,rx:shapeRadius(barWidth,barHeight,'bar'),fillRole:'bar',fill:c,'fill-opacity':.25},group));
    const node=label(binary(code),compact?width/2:layout.left+(code+.5)*layout.step,layout.labelY,{'text-anchor':'middle','font-size':16,fill:c},group);
    labels.push({node,compact});
  });
  svg('line',{x1:layout.left,y1:layout.baseline,x2:layout.right,y2:layout.baseline,strokeRole:'frame',stroke:c,'stroke-opacity':.2},group);
  return {group,bars,labels,layout};
}
function buildHeatmapFactor(scene,u,x,y,width,height) {
  const {group,bars,labels,layout}=buildCompactFactor(scene,u,x,y,width,height);
  heatmapSources[u]=bars;heatmapSourceLabels[u]=labels;
  svg('rect',{width,height,fill:'transparent',style:'cursor:pointer'},group);
  bindInteractionRegion(group,event=>{
    const local=scenePoint(scene,event),d=Math.max(0,Math.min(config.dp-1,Math.floor((local.x-x-layout.left)/layout.step)));
    heatmapHover={u,d};progress=heatmapProgress((config.U-1-u)*config.dp+d);renderHeatmap();
  });
}
function buildHeatmapScene() {
  const scene=$('heatmap-scene');scene.replaceChildren();
  const topSlots=new Set([...probabilities.keys()].sort((a,b)=>probabilities[b]-probabilities[a]||a-b).slice(0,config.topK));
  scene.setAttribute('aria-label','Four-dimensional address lattice. Each factor value activates a 64-point slice.');
  const sourceX=28,sourceSize=factorSize(config.cardWidth);
  const {width,height}=animationSize(scene,Math.max(480,sourceSize.height*4+config.cardGap*3+64));
  const sourceStart=(height-sourceSize.height*4-config.cardGap*3)/2;
  heatmapSources=[];heatmapSourceLabels=[];heatmapNodes=[];heatmapEdges=[];
  for(let u=3;u>=0;u--)buildHeatmapFactor(scene,u,sourceX,sourceStart+(3-u)*(sourceSize.height+config.cardGap),sourceSize.width,sourceSize.height);
  const rightX=sourceX+sourceSize.width+30,rightWidth=width-rightX-25;
  heatmapLayout={x:rightX+rightWidth/2,y:height/2,
    unit:Math.min(rightWidth*.88/heatmapProjectionSize.width,height*.8/heatmapProjectionSize.height)};
  const edgeGroup=svg('g',{'pointer-events':'none'},scene);
  for(let s=0;s<4;s++)for(let axis=0;axis<3;axis++)for(let a=0;a<4;a++)for(let b=0;b<4;b++) {
    const from=[0,0,0,s],to=[0,0,0,s],other=[0,1,2].filter(u=>u!==axis);
    from[other[0]]=to[other[0]]=a;from[other[1]]=to[other[1]]=b;to[axis]=3;
    const node=svg('line',{stroke:outputColor(),'stroke-width':.75,'stroke-opacity':.1},edgeGroup);
    heatmapEdges.push({node,from:address(from),to:address(to),parts:from,axis});
  }
  heatmapPoints=svg('g',{'pointer-events':'none'},scene);
  const min=Math.min(...probabilities),max=Math.max(...probabilities);
  for(let slot=0;slot<total;slot++) {
    const parts=digits(slot),strength=max===min?.5:(probabilities[slot]-min)/(max-min),top=topSlots.has(slot);
    const node=svg('circle',{r:4.5,...probabilityAppearance(outputColor(),strength),stroke:top?palette.neutral('dark'):palette.neutral(0),'stroke-opacity':top?.95:.28+.3*palette.weight(strength,outputColor()),'stroke-width':top?1.4:.7,
      'pointer-events':'all',style:'cursor:pointer','data-slot':slot,'data-top-k':top},heatmapPoints);
    bindInteractionRegion(node,()=>{
      const factor=config.U-1-Math.floor(Math.max(0,Math.min(config.U*config.dp-1,heatmapFrame()))/config.dp);
      heatmapHover={slot};progress=heatmapProgress((config.U-1-factor)*config.dp+parts[factor]);
      renderHeatmap();
    });
    heatmapNodes.push({node,parts,strength,slot,top,scale:heatmapScales[parts[3]],depth:0});
  }
  heatmapLastFrame=0;currentIndex=-1;renderHeatmap();
}
function heatmapProject(parts,scale,cosTheta,sinTheta,cosPhi,sinPhi) {
  const x=(parts[0]-1.5)*scale,y=(parts[1]-1.5)*scale,z=(parts[2]-1.5)*scale;
  // Camera = r * (cos(phi)*cos(theta), cos(phi)*sin(theta), sin(phi)), looking at the origin.
  const radial=x*cosTheta+y*sinTheta,horizontal=-x*sinTheta+y*cosTheta;
  const vertical=z*cosPhi-radial*sinPhi,depth=radial*cosPhi+z*sinPhi;
  const perspective=heatmapOrbit.radius/(heatmapOrbit.radius-depth);
  return {x:horizontal*perspective,y:-vertical*perspective,depth,perspective};
}
function measureHeatmapOrbit() {
  // Size the entire orbit once. Outer corners bound every inner lattice point.
  let width=0,height=0;
  const scale=Math.max(...heatmapScales);
  for(let yaw=0;yaw<=36;yaw++)for(let tilt=0;tilt<=20;tilt++) {
    const theta=yaw*Math.PI/72,phi=heatmapOrbit.phiMean+heatmapOrbit.phiAmplitude*(tilt/10-1);
    const cosTheta=Math.cos(theta),sinTheta=Math.sin(theta),cosPhi=Math.cos(phi),sinPhi=Math.sin(phi);
    let top=Infinity,bottom=-Infinity;
    for(const x of [0,3])for(const y of [0,3])for(const z of [0,3]) {
      const point=heatmapProject([x,y,z],scale,cosTheta,sinTheta,cosPhi,sinPhi);
      width=Math.max(width,2*Math.abs(point.x));
      top=Math.min(top,point.y);bottom=Math.max(bottom,point.y);
    }
    height=Math.max(height,bottom-top);
  }
  return {width:width*1.01,height:height*1.01};
}
function renderHeatmap(timestamp=heatmapTime) {
  const scan=heatmapFrame();
  const scanning=viewState!=='rest'&&(heatmapHover!==null||scan>=0&&scan<config.U*config.dp);
  const {u,d}=heatmapHover??{u:config.U-1-Math.floor(scan/config.dp),d:scan%config.dp};
  const slotParts=heatmapHover?.slot===undefined?null:digits(heatmapHover.slot);
  for(let factor=0;factor<4;factor++) {
    const selectedValue=scanning?(slotParts?slotParts[factor]:factor===u?d:-1):-1;
    heatmapSources[factor].forEach((bar,value)=>set(bar,{'fill-opacity':scanning?(value===selectedValue?1:.22):.55}));
    heatmapSourceLabels[factor].forEach(({node,compact},value)=>{
      const selected=value===selectedValue;
      set(node,{opacity:compact?(selected||viewState==='rest'&&value===0?1:0):scanning&&!selected?.55:1,'font-weight':selected?700:400});
    });
  }
  const time=timestamp/1000,theta=heatmapOrbit.thetaRate*time;
  const phi=heatmapOrbit.phiMean+heatmapOrbit.phiAmplitude*Math.sin(heatmapOrbit.phiRate*time);
  const cosTheta=Math.cos(theta),sinTheta=Math.sin(theta),cosPhi=Math.cos(phi),sinPhi=Math.sin(phi);
  const points=Array.from({length:total});
  heatmapNodes.forEach(item=>{
    const point=heatmapProject(item.parts,item.scale,cosTheta,sinTheta,cosPhi,sinPhi);
    points[item.slot]={...point,x:heatmapLayout.x+point.x*heatmapLayout.unit,y:heatmapLayout.y+point.y*heatmapLayout.unit};
  });
  for(const edge of heatmapEdges) {
    const from=points[edge.from],to=points[edge.to],active=scanning&&!slotParts&&edge.parts[u]===d&&(edge.axis!==u||u===3);
    set(edge.node,{x1:from.x.toFixed(1),y1:from.y.toFixed(1),x2:to.x.toFixed(1),y2:to.y.toFixed(1),
      stroke:active?color(u):outputColor(),'stroke-opacity':active?.22:.06,'stroke-width':active?1:.7});
  }
  heatmapNodes.forEach(item=>{
    const point=points[item.slot],active=scanning&&(slotParts?item.slot===heatmapHover.slot:item.parts[u]===d);
    item.depth=point.depth;
    set(item.node,{cx:point.x.toFixed(1),cy:point.y.toFixed(1),
      r:((active?4.5:3.1)*1.5*point.perspective).toFixed(1),
      ...probabilityAppearance(active&&!slotParts?color(u):outputColor(),item.strength),
      stroke:item.top?palette.neutral('dark'):active&&slotParts?outputColor():palette.neutral(0),
      'stroke-opacity':item.top?.95:active&&slotParts?.9:.28+.3*palette.weight(item.strength,active&&!slotParts?color(u):outputColor()),'stroke-width':item.top||active&&slotParts?1.4:.7});
  });
  heatmapNodes.sort((a,b)=>a.depth-b.depth);
  // Keep hovered nodes attached unless their depth order actually changes.
  let next=heatmapPoints.firstElementChild;
  for(const {node} of heatmapNodes) {
    if(node===next)next=next.nextElementSibling;
    else heatmapPoints.insertBefore(node,next);
  }
}
function buildRegroupStrip(scene,x,y,width,height,values,c) {
  const inset=8,left=x+inset,step=(width-inset*2)/values.length;
  const max=probabilityCeiling(Math.max(...values)),baseline=y+height-inset,plotHeight=height-inset*2;
  const gap=Math.min(1.2,step*.2),group=svg('g',{'data-regroup-distribution':64},scene);
  svg('rect',{x,y,width,height,rx:shapeRadius(width,height,'frame'),fillRole:'background',fill:c,
    'fill-opacity':.045,strokeRole:'frame',stroke:c,'stroke-opacity':diagram.alpha.border},group);
  const bars=values.map((value,i)=>{
    const barHeight=value/max*plotHeight;
    return svg('rect',{x:left+i*step+gap/2,y:baseline-barHeight,width:step-gap,height:barHeight,rx:1,
      fillRole:'bar',fill:c,'fill-opacity':.55,'data-probability':value},group);
  });
  svg('line',{x1:left,y1:baseline,x2:x+width-inset,y2:baseline,stroke:c,'stroke-opacity':.25},group);
  const selection=svg('rect',{x:left,y:y+3,width:step,height:height-6,rx:1,
    fill:c,'fill-opacity':.12,stroke:c,'stroke-width':1.2},group);
  return {group,x,y,width,height,left,step,bars,selection};
}
function buildRegroupMatrix(scene,x,y,cols,cellSize,rowColor,columnColor,topSlots) {
  const rows=total/cols,width=cols*cellSize,height=rows*cellSize;
  const gap=Math.min(.9,cellSize*.15),min=Math.min(...probabilities),max=Math.max(...probabilities);
  const group=svg('g',{'data-regroup-matrix':cols===4?'64x4':'4x64'},scene);
  for(let slot=0;slot<total;slot++) {
    const selected=topSlots.has(slot),strength=max===min?.5:(probabilities[slot]-min)/(max-min);
    svg('rect',{x:x+(slot%cols)*cellSize+gap/2,y:y+Math.floor(slot/cols)*cellSize+gap/2,
      width:cellSize-gap,height:cellSize-gap,rx:Math.min(1,cellSize/8),
      ...probabilityAppearance(outputColor(),strength),
      stroke:palette.neutral('dark'),'stroke-width':1.2,'stroke-opacity':selected?.95:0,
      'data-slot':slot,'data-top-k':selected,'data-layout':cols===4?'64x4':'4x64'},group);
  }
  const rowGuide=svg('rect',{x,y,width,height:cellSize,fill:rowColor,'fill-opacity':.12,
    stroke:rowColor,'stroke-opacity':.65,'stroke-width':.8},group);
  const columnGuide=svg('rect',{x,y,width:cellSize,height,fill:columnColor,'fill-opacity':.12,
    stroke:columnColor,'stroke-opacity':.65,'stroke-width':.8},group);
  const selection=svg('rect',{x,y,width:cellSize-gap,height:cellSize-gap,rx:1,
    fill:'none',stroke:palette.tone('sky','ink'),'stroke-width':1.6,'pointer-events':'none'},group);
  svg('rect',{x,y,width,height,rx:1.5,fill:'none',stroke:palette.neutral(7),
    'stroke-width':1,'stroke-opacity':.65,'pointer-events':'none'},group);
  svg('rect',{x,y,width,height,fill:'transparent',style:'cursor:crosshair'},group);
  bindInteractionRegion(group,event=>{
    const local=scenePoint(scene,event);
    const column=Math.max(0,Math.min(cols-1,Math.floor((local.x-x)/cellSize)));
    const row=Math.max(0,Math.min(rows-1,Math.floor((local.y-y)/cellSize)));
    seekIndex(row*cols+column);
  });
  return {x,y,width,height,cols,cellSize,gap,rowGuide,columnGuide,selection};
}
function buildRegroupScene() {
  const scene=$('regroup-scene');scene.replaceChildren();
  const topSlots=new Set([...probabilities.keys()].sort((a,b)=>probabilities[b]-probabilities[a]||a-b).slice(0,config.topK));
  const sourceSize=factorSize(config.cardWidth);
  const {width,height}=animationSize(scene,660);
  const factorGap=Math.max(config.cardGap,Math.min(64,(width-sourceSize.width*4-220)/3));
  const pitch=sourceSize.width+factorGap,sourceWidth=sourceSize.width*4+factorGap*3;
  const cellSize=Math.min(sourceWidth+40,height-80)/64;
  const sourceX=(width-sourceWidth-46-40-cellSize*4-40)/2+46;
  const sourceY=height*.45-sourceSize.height/2,sourceBottom=sourceY+sourceSize.height;
  const centers=Array.from({length:4},(_,i)=>sourceX+i*pitch+sourceSize.width/2);
  const upperMultiply={x:centers[1],y:sourceY-52},lowerMultiply={x:centers[2],y:sourceBottom+52};
  const stripWidth=sourceSize.width*3+factorGap*2,stripHeight=64;
  const wideX=sourceX+(sourceWidth-cellSize*64)/2,wideY=height-46-cellSize*4;
  const tallY=height-24-cellSize*64,tallX=sourceX+sourceWidth+40;
  const mergedColors=[diagram.colors.pink,diagram.text(diagram.colors.pink)];
  const routeColor=u=>u<config.U?color(u):mergedColors[u-config.U];
  const factorX=(u,index)=>{
    const bar=index===null?null:regroupSources[u][digits(index)[u]];
    return sourceX+(3-u)*pitch+(bar?Number(bar.getAttribute('x'))+Number(bar.getAttribute('width'))/2:sourceSize.width/2);
  };
  const defs=svg('defs',{},scene);
  for(let u=0;u<=config.U+1;u++) {
    const marker=svg('marker',{id:'regroup-arrow-'+u,viewBox:'0 0 8 8',refX:8,refY:4,
      markerWidth:6,markerHeight:6,markerUnits:'userSpaceOnUse',orient:'auto'},defs);
    svg('path',{d:'M0 0L8 4L0 8Z',fillRole:'arrow',fill:routeColor(u)},marker);
  }
  const routes=svg('g',{'pointer-events':'none'},scene);
  const connect=(points,u=config.U)=>svg('path',{d:points?roundedRoute(points):'',fill:'none',
    strokeRole:'arrow',stroke:routeColor(u),'stroke-width':1.6,'stroke-opacity':.75,
    'stroke-linecap':'round','stroke-linejoin':'round','marker-end':'url(#regroup-arrow-'+u+')'},routes);
  const multiply=(node,c)=>{
    svg('circle',{cx:node.x,cy:node.y,r:16,fill:'none',stroke:c,'stroke-width':1.2},scene);
    svg('path',{d:'M'+(node.x-5.5)+' '+(node.y-5.5)+'l11 11m0-11-11 11',
      fill:'none',stroke:c,'stroke-width':1.6,'stroke-linecap':'round'},scene);
  };
  regroupLinks=[];
  for(let i=0;i<3;i++) {
    const u=3-i,endX=upperMultiply.x+(i-1)*19;
    regroupLinks.push({path:connect(null,u),points:index=>{
      const x=factorX(u,index);
      return i===1?[[x,sourceY-5],[x,upperMultiply.y+32],[upperMultiply.x,upperMultiply.y+32],[upperMultiply.x,upperMultiply.y+19]]:
        [[x,sourceY-5],[x,upperMultiply.y],[endX,upperMultiply.y]];
    }});
  }
  for(let i=1;i<4;i++) {
    const u=3-i,endX=lowerMultiply.x+(i-2)*19;
    regroupLinks.push({path:connect(null,u),points:index=>{
      const x=factorX(u,index);
      return i===2?[[x,sourceBottom+5],[x,lowerMultiply.y-32],[lowerMultiply.x,lowerMultiply.y-32],[lowerMultiply.x,lowerMultiply.y-19]]:
        [[x,sourceBottom+5],[x,lowerMultiply.y],[endX,lowerMultiply.y]];
    }});
  }
  multiply(upperMultiply,mergedColors[0]);multiply(lowerMultiply,mergedColors[1]);
  regroupSources=[];
  for(let i=0;i<4;i++) {
    const u=3-i;
    const factorX=sourceX+i*pitch,factor=buildCompactFactor(scene,u,factorX,sourceY,sourceSize.width,sourceSize.height);
    regroupSources[u]=factor.bars;
    const hit=svg('rect',{width:sourceSize.width,height:sourceSize.height,fill:'transparent'},factor.group);
    bindFactorScan(hit,scene,u,factorX+factor.layout.left,factor.layout.step);
  }
  const upperValues=Array.from({length:64},(_,i)=>{
    const p=digits(i*4);return distributions[3][p[3]]*distributions[2][p[2]]*distributions[1][p[1]];
  });
  const lowerValues=Array.from({length:64},(_,i)=>{
    const p=digits(i);return distributions[2][p[2]]*distributions[1][p[1]]*distributions[0][p[0]];
  });
  regroupStrips={
    upper64:buildRegroupStrip(scene,sourceX,62,stripWidth,stripHeight,upperValues,mergedColors[0]),
    lower64:buildRegroupStrip(scene,sourceX+pitch,lowerMultiply.y+64,stripWidth,stripHeight,lowerValues,mergedColors[1])
  };
  regroupPanels={
    tall:buildRegroupMatrix(scene,tallX,tallY,4,cellSize,mergedColors[0],color(0),topSlots),
    wide:buildRegroupMatrix(scene,wideX,wideY,64,cellSize,color(3),mergedColors[1],topSlots)
  };
  const captionStyle={'font-size':17,'font-weight':700,'letter-spacing':.6,
    'font-family':'Inter, Segoe UI, Arial, sans-serif','text-anchor':'middle','pointer-events':'none'};
  const sideX=tallX-15,sideY=tallY+cellSize*32;
  label('View A',sideX,sideY,{...captionStyle,fill:mergedColors[0],
    transform:`rotate(-90 ${sideX} ${sideY})`},scene);
  label('View B',wideX+cellSize*32,height-14,{...captionStyle,fill:mergedColors[1]},scene);
  const upper=regroupStrips.upper64,lower=regroupStrips.lower64;
  bindFactorScan(upper.group,scene,1,upper.left,upper.step,64);
  bindFactorScan(lower.group,scene,0,lower.left,lower.step,64);
  const upperX=index=>upper.left+(index===null?32:Math.floor(index/4)+.5)*upper.step;
  const lowerX=index=>lower.left+(index===null?32:index%64+.5)*lower.step;
  regroupLinks.push(
    {path:connect(null),points:index=>[[upperMultiply.x,upperMultiply.y-19],
      [upperMultiply.x,(upperMultiply.y-19+upper.y+upper.height+5)/2],
      [upperX(index),(upperMultiply.y-19+upper.y+upper.height+5)/2],[upperX(index),upper.y+upper.height+5]]},
    {path:connect(null,config.U+1),points:index=>[[lowerMultiply.x,lowerMultiply.y+19],
      [lowerMultiply.x,(lowerMultiply.y+19+lower.y-5)/2],
      [lowerX(index),(lowerMultiply.y+19+lower.y-5)/2],[lowerX(index),lower.y-5]]},
    {path:connect(null),points:index=>{
      const y=tallY+(index===null?32:Math.floor(index/4)+.5)*cellSize,outerX=tallX+cellSize*4+40;
      return [[upperX(index),upper.y-5],[upperX(index),12],[outerX,12],[outerX,y],[tallX+cellSize*4+5,y]];
    }},
    {path:connect(null,0),points:index=>{
      const x=tallX+(index===null?2:index%4+.5)*cellSize;
      const startX=factorX(0,index);
      return [[startX,sourceY-5],[startX,26],[x,26],[x,tallY-5]];
    }},
    {path:connect(null,config.U+1),points:index=>{
      const x=wideX+(index===null?32:index%64+.5)*cellSize,y=(lower.y+lower.height+wideY)/2;
      return [[lowerX(index),lower.y+lower.height+5],[lowerX(index),y],[x,y],[x,wideY-5]];
    }},
    {path:connect(null,3),points:index=>{
      const y=wideY+(index===null?2:Math.floor(index/64)+.5)*cellSize,outerX=wideX-26;
      const startX=factorX(3,index);
      return [[startX,sourceBottom+5],[startX,sourceBottom+28],[outerX,sourceBottom+28],[outerX,y],[wideX-5,y]];
    }}
  );
  const addressStyle={'font-family':'ui-monospace, SFMono-Regular, monospace','font-size':12,
    'font-weight':700,'paint-order':'stroke',stroke:palette.color('paper'),'stroke-width':3,
    'stroke-linejoin':'round','pointer-events':'none'};
  regroupAddressLabels={
    tallRow:label('',tallX+cellSize*4+5,0,{...addressStyle,fill:mergedColors[0]},scene),
    tallCol:label('',0,tallY-10,{...addressStyle,fill:color(0),'text-anchor':'middle'},scene),
    wideCol:label('',0,wideY-10,{...addressStyle,fill:mergedColors[1],'text-anchor':'middle'},scene),
    wideRow:label('',wideX-10,0,{...addressStyle,fill:color(3),'text-anchor':'end'},scene)
  };
  currentIndex=-1;renderRegroup();
}
function renderRegroup() {
  const index=indexAt(progress),scanning=viewState!=='rest';
  if(index===currentIndex)return;
  currentIndex=index;
  const parts=digits(index);
  regroupSources.forEach((bars,u)=>bars.forEach((bar,d)=>set(bar,{'fill-opacity':d===parts[u]?1:.24})));
  for(const [name,value] of [['upper64',Math.floor(index/4)],['lower64',index%64]]) {
    const strip=regroupStrips[name];
    set(strip.selection,{x:strip.left+value*strip.step,opacity:scanning?1:0});
    strip.bars.forEach((bar,i)=>set(bar,{'fill-opacity':scanning&&i===value?1:.55}));
  }
  for(const panel of Object.values(regroupPanels)) {
    const x=panel.x+(index%panel.cols)*panel.cellSize,y=panel.y+Math.floor(index/panel.cols)*panel.cellSize;
    set(panel.rowGuide,{y,opacity:scanning?1:0});set(panel.columnGuide,{x,opacity:scanning?1:0});
    set(panel.selection,{x:x+panel.gap/2,y:y+panel.gap/2,opacity:scanning?1:0});
  }
  for(const link of regroupLinks)set(link.path,{d:roundedRoute(link.points(index))});
  const {tall,wide}=regroupPanels;
  const tallRow=Math.floor(index/tall.cols),tallCol=index%tall.cols;
  const wideRow=Math.floor(index/wide.cols),wideCol=index%wide.cols;
  set(regroupAddressLabels.tallRow,{y:tall.y+(tallRow+.5)*tall.cellSize-5});
  set(regroupAddressLabels.tallCol,{x:tall.x+(tallCol+.5)*tall.cellSize});
  set(regroupAddressLabels.wideCol,{x:wide.x+(wideCol+.5)*wide.cellSize});
  set(regroupAddressLabels.wideRow,{y:wide.y+(wideRow+.5)*wide.cellSize-5});
  regroupAddressLabels.tallRow.textContent=tallRow.toString(2).padStart(6,'0');
  regroupAddressLabels.tallCol.textContent=tallCol.toString(2).padStart(2,'0');
  regroupAddressLabels.wideCol.textContent=wideCol.toString(2).padStart(6,'0');
  regroupAddressLabels.wideRow.textContent=wideRow.toString(2).padStart(2,'0');
}
function buildWaveformScene() {
  const scene=$('waveform-scene');scene.replaceChildren();waveformRows=[];waveformBars=[];
  const sourceX=48,sourceWidth=config.cardWidth,x=sourceX+sourceWidth+52,fontScale=config.diagramFontScale/100,startY=28;
  const baseRowHeight=Math.max(config.waveformHeight,(24*fontScale+18)/(1-2*config.factorPadding/100)),gap=Math.max(config.waveformGap,16+24.3*fontScale+config.waveformAddressGap),footer=Math.max(48,32*fontScale+20);
  const {width:sceneWidth,height}=animationSize(scene,startY+(config.U+1)*baseRowHeight+config.U*gap+footer);
  const rowHeight=(height-startY-footer-config.U*gap)/(config.U+1),width=sceneWidth-48-x;
  const inset=Math.min(rowHeight*.12,width*.05),plotX=x+inset,plotWidth=width-2*inset,step=plotWidth/total;
  const topSlots=new Set([...probabilities.keys()].sort((a,b)=>probabilities[b]-probabilities[a]||a-b).slice(0,config.topK));
  waveformLayout={plotX,plotWidth,step,topSlots};
  const defs=svg('defs',{},scene),max=Math.max(...probabilities)||1;
  for(let depth=0;depth<=config.U;depth++) {
    const isOutput=depth===config.U,u=config.U-1-depth,c=isOutput?outputColor():color(u),y=startY+depth*(rowHeight+gap),baseline=y+rowHeight-inset,plotHeight=rowHeight-2*inset;
    const group=svg('g',{opacity:0},scene),sourceBars=[],sourceGroups=[],sourceLabels=[];
    if(!isOutput) {
      const source=factorSize(sourceWidth,rowHeight),sourceY=y+(rowHeight-source.height)/2,factorX=sourceX+(sourceWidth-source.width)/2;
      const layout=factorLayout(factorX,sourceY,source.width,source.height,true);
      const compact=layout.step<bits*16*fontScale*.6+2;
      svg('rect',{x:factorX,y:sourceY,width:source.width,height:source.height,rx:shapeRadius(source.width,source.height,'frame'),fillRole:'background',fill:c,'fill-opacity':.055,strokeRole:'frame',stroke:c,'stroke-opacity':diagram.alpha.border},group);
      const arrowY=y+rowHeight/2,arrowEnd=x-12;
      svg('path',{d:`M${factorX+source.width+10} ${arrowY}H${arrowEnd}m-6-4 6 4-6 4`,fill:'none',strokeRole:'arrow',stroke:c,'stroke-width':1.5,'stroke-linecap':'round','stroke-linejoin':'round'},group);
      distributions[u].forEach((p,code)=>{
        const sourceGroup=svg('g',{'data-code':code,opacity:0},group);sourceGroups.push(sourceGroup);
        const barWidth=layout.step*(1-config.barGap/100),barX=layout.left+code*layout.step+(layout.step-barWidth)/2,barHeight=p*layout.plotHeight;
        sourceBars.push(svg('rect',{x:barX,y:layout.baseline-barHeight,width:barWidth,height:barHeight,rx:shapeRadius(barWidth,barHeight,'bar'),fillRole:'bar',fill:c,'fill-opacity':.6},sourceGroup));
        const node=label(binary(code),compact?sourceX+sourceWidth/2:barX+barWidth/2,layout.labelY,{'text-anchor':'middle','font-size':16,fill:c},sourceGroup);
        sourceLabels.push({node,compact});
      });
    }
    svg('rect',{x,y,width,height:rowHeight,rx:shapeRadius(width,rowHeight,'frame'),fillRole:'background',fill:c,'fill-opacity':.045,strokeRole:'frame',stroke:c,'stroke-opacity':diagram.alpha.border},group);
    svg('line',{x1:plotX,y1:baseline,x2:plotX+plotWidth,y2:baseline,strokeRole:'frame',stroke:c,'stroke-opacity':.2},group);
    let revealClip=null;
    if(isOutput) {
      const clip=svg('clipPath',{id:`waveform-reveal-${depth}`,clipPathUnits:'userSpaceOnUse'},defs);
      revealClip=svg('rect',{x:plotX,y,width:0,height:rowHeight},clip);
    }
    const data=svg('g',isOutput?{'clip-path':`url(#waveform-reveal-${depth})`}:{},group);
    const codeGroups=isOutput?[]:Array.from({length:config.dp},(_,code)=>svg('g',{'data-code':code,opacity:0},data));
    const values=Array.from({length:total},(_,index)=>isOutput?probabilities[index]:distributions[u][Math.floor(index/config.dp**u)%config.dp]);
    const scale=isOutput?max:1;
    const rowBars=values.map((value,index)=>{
      const barWidth=step*(1-config.barGap/100),barHeight=value/scale*plotHeight;
      return svg('rect',{x:plotX+index*step+(step-barWidth)/2,y:baseline-barHeight,width:barWidth,height:barHeight,rx:shapeRadius(barWidth,barHeight,'bar'),fillRole:'bar',fill:c,'fill-opacity':isOutput?(topSlots.has(index)?.65:.23):.5},isOutput?data:codeGroups[Math.floor(index/config.dp**u)%config.dp]);
    });
    if(isOutput)waveformBars=rowBars;
    waveformRows.push({group,revealClip,sourceBars,sourceGroups,sourceLabels,codeGroups,rowBars,values,baseline,plotHeight,scale,y,c,u});
  }
  waveformReadout=svg('g',{opacity:0,'pointer-events':'none'},scene);
  waveformScan=svg('g',{},waveformReadout);
  waveformRows.forEach((row,depth)=>{
    row.scanLine=svg('line',{x1:0,x2:0,y1:row.y-4,y2:row.y+rowHeight+4,strokeRole:'frame',stroke:palette.neutral(6),'stroke-width':1.3,'stroke-dasharray':'4 5','stroke-opacity':.7},waveformScan);
    row.point=svg('circle',{r:3,fillRole:'bar',fill:row.c,stroke:palette.mix(palette.color('paper'),palette.neutral(16),9/20),'stroke-width':1.2},waveformReadout);
    row.address=label('',0,row.y+rowHeight+12+(depth===config.U?20:18)*fontScale,{'text-anchor':'middle','font-size':depth===config.U?20:18,fill:row.c},waveformReadout);
    row.addressParts=[];
    for(let u=config.U-1;u>=0;u--){
      const relevant=depth===config.U||u===row.u;
       const inactive=palette.ranges.inactiveFactor;
       row.addressParts[u]=svg('tspan',{fill:relevant?color(u):`hsl(${colorHue(color(u))} ${inactive.saturation}% ${inactive.lightness}%)`,'fill-opacity':relevant?1:inactive.opacity},row.address);
    }
  });
  const hit=svg('rect',{x:plotX,y:startY,width:plotWidth,height:height-startY-12,fill:'transparent',style:'cursor:crosshair',role:'presentation'},scene);
  bindInteractionRegion(hit,event=>{
    const local=scenePoint(scene,event);
    seekIndex(Math.floor((local.x-plotX)/plotWidth*total));
  });
  currentIndex=-1;render();
}
function renderWaveform() {
  const scanStart=config.waveformRevealDuration/sectionDuration();
  const revealed=viewState!=='animation'||progress>=scanStart,scanning=viewState!=='rest'&&revealed;
  waveformRows.forEach((row,depth)=>{
    const reveal=revealed?1:Math.max(0,Math.min(1,progress/scanStart*(config.U+1)-depth));
    set(row.group,{opacity:Math.min(1,reveal*4)});
    if(row.revealClip)set(row.revealClip,{width:waveformLayout.plotWidth*(1-(1-reveal)**3)});
    row.codeGroups.forEach((codeGroup,code)=>{
      const amount=1-(1-Math.max(0,Math.min(1,reveal*config.dp-code)))**3;
      set(codeGroup,{opacity:amount});set(row.sourceGroups[code],{opacity:amount});
      const {node,compact}=row.sourceLabels[code];
      if(!scanning)set(node,{opacity:compact?(code===(viewState==='rest'?0:Math.min(config.dp-1,Math.floor(reveal*config.dp)))?1:0):1,'font-weight':400});
    });
    if(!scanning)row.sourceBars.forEach(bar=>set(bar,{'fill-opacity':.6}));
  });
  set(waveformReadout,{opacity:scanning?1:0});
  const index=indexAt(progress),parts=digits(index),{plotX,plotWidth,step,topSlots}=waveformLayout;
  currentIndex=index;
  if(scanning) {
    const x=plotX+(index+.5)*step;
    set(waveformScan,{transform:`translate(${x} 0)`});
    waveformRows.forEach((row,depth)=>{
      set(row.point,{cx:x,cy:row.baseline-row.values[index]/row.scale*row.plotHeight});
      const margin=bits*config.U*(depth===config.U?20:18)*config.diagramFontScale/100*.32+4;
      set(row.address,{x:Math.max(plotX+margin,Math.min(plotX+plotWidth-margin,x))});
      for(let u=0;u<config.U;u++)row.addressParts[u].textContent=binary(parts[u]);
      if(depth!==config.U) {
        row.sourceBars.forEach((bar,code)=>set(bar,{'fill-opacity':code===parts[row.u]?1:diagram.alpha.low}));
        row.sourceLabels.forEach(({node,compact},code)=>set(node,{opacity:compact?(code===parts[row.u]?1:0):1,'font-weight':code===parts[row.u]?700:400}));
      }
    });
    waveformRows.slice(1).forEach((row,depth)=>{
      const address=waveformRows[depth].address.getBBox();
      set(row.scanLine,{y1:address.y+address.height+config.waveformAddressGap});
    });
  }
  waveformRows.slice(0,config.U).forEach(row=>row.rowBars.forEach((bar,i)=>set(bar,{'fill-opacity':scanning&&i===index?1:.5})));
  waveformBars.forEach((bar,i)=>set(bar,{'fill-opacity':viewState==='rest'?.55:scanning&&i===index?1:topSlots.has(i)?.65:diagram.alpha.low}));
  renderTimeline(scanning?1:0,scanning?index.toString(2).padStart(bits*config.U,'0'):'3 → 2 → 1 → 0');
}
function layoutPages() {
  const shell=document.querySelector('.animation-shell');
  const compact=window.ramnetCompactInteractions.matches;
  const compactTabs=document.querySelector('.compact-tabs'),pages=document.querySelector('.section-pages');
  pages.setAttribute('role',compact?'presentation':'tablist');
  if(compact)pages.removeAttribute('aria-orientation');
  else pages.setAttribute('aria-orientation','vertical');
  SECTIONS.forEach(name=>{
    const tab=$(name+'-tab'),parent=compact?compactTabs:$(name+'-page');
    if(tab.parentElement!==parent)parent.append(tab);
  });
  const mobile=window.matchMedia('(max-width:540px)').matches,style=getComputedStyle($('distribution-tab'));
  const measure=document.createElement('canvas').getContext('2d');
  measure.font=`700 ${style.fontSize} ${style.fontFamily}`;
  const tabWidth=compact?0:Math.ceil(Math.max(...SECTIONS.map(name=>measure.measureText(SECTION_NAMES[name]).width)))+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+2;
  if(articleLayout&&!compact) {
    // The article reserves the tab gutter; the page body uses the prose width exactly.
    const bodyWidth=articleLayout.width;
    shell.style.marginLeft=articleLayout.left+'px';
    shell.style.marginRight='0px';
    shell.style.width=(bodyWidth+tabWidth+16)+'px';
  } else {
    shell.style.removeProperty('margin-left');
    shell.style.removeProperty('margin-right');
    shell.style.removeProperty('width');
  }
  const width=shell.clientWidth-16,height=shell.clientHeight-16;
  const flipContainer=document.querySelector('.card-scroll'),perspective=Math.max(3600,width*3);
  // Reserve the maximum projected height without changing the figure's flow height.
  flipContainer.style.setProperty('--page-perspective',perspective+'px');
  flipContainer.style.setProperty('--page-flip-bleed',Math.ceil(height*width/(2*(perspective-width))+24)+'px');
  const bodyWidth=width-tabWidth,tabHeight=compact?44:Math.min(mobile?30:40,height*.5*(mobile?.18:.21));
  const radius=config.animationRadius*.68,fontSize=parseFloat(style.fontSize);
  const safeInset=radius+fontSize;
  const gap=compact?12:Math.max(0,Math.min(fontSize*2.4,
    (height-2*safeInset-SECTIONS.length*tabHeight)/(SECTIONS.length-1)));
  const join=Math.min(mobile?4:14,gap/2),corner=Math.min(9,tabHeight/2);
  shell.style.setProperty('--page-body-width',bodyWidth+'px');
  shell.style.setProperty('--page-tab-width',tabWidth+'px');
  shell.style.setProperty('--page-tab-height',tabHeight+'px');
  SECTIONS.forEach((name,index)=>{
    const top=(height-SECTIONS.length*tabHeight-(SECTIONS.length-1)*gap)/2+index*(tabHeight+gap),bottom=top+tabHeight,right=width-.5,end=height-.5;
    $(name+'-tab').style.top=top+'px';
    if(compact) {
      $(name+'-tab').style.removeProperty('top');
      $(name+'-page').querySelector('path').setAttribute('d',`M ${.5+radius} .5 H ${right-radius} Q ${right} .5 ${right} ${.5+radius} V ${end-radius} Q ${right} ${end} ${right-radius} ${end} H ${.5+radius} Q .5 ${end} .5 ${end-radius} V ${.5+radius} Q .5 .5 ${.5+radius} .5 Z`);
      return;
    }
    // A single silhouette joins the page and tab; its shadow belongs to the same layer.
    $(name+'-page').querySelector('path').setAttribute('d',`M ${.5+radius} .5 H ${bodyWidth-radius} Q ${bodyWidth} .5 ${bodyWidth} ${.5+radius}
      V ${top-join} A ${join} ${join} 0 0 0 ${bodyWidth+join} ${top} H ${right-corner} Q ${right} ${top} ${right} ${top+corner}
      V ${bottom-corner} Q ${right} ${bottom} ${right-corner} ${bottom} H ${bodyWidth+join} A ${join} ${join} 0 0 0 ${bodyWidth} ${bottom+join}
      V ${end-radius} Q ${bodyWidth} ${end} ${bodyWidth-radius} ${end} H ${.5+radius} Q .5 ${end} .5 ${end-radius}
      V ${.5+radius} Q .5 .5 ${.5+radius} .5 Z`);
  });
  const shellStyle=getComputedStyle(shell),tabsStyle=getComputedStyle(compactTabs);
  const controls=document.querySelector('.interaction-panel'),controlsHeight=controls.offsetHeight;
  // Exclude scrollbars and the scene height so width fitting cannot feed back into itself.
  const chromeHeight=parseFloat(shellStyle.marginTop)+parseFloat(shellStyle.marginBottom)+controlsHeight+
    (compact?compactTabs.offsetHeight+parseFloat(tabsStyle.marginTop)+parseFloat(tabsStyle.marginBottom):0);
  document.body.getRootNode().host?.dispatchEvent(new CustomEvent('ramnet:layout-metrics',{detail:{
    tabWidth,
    aspect:config.interactionAspect,
    chromeHeight
  }}));
}
function arrangePages() {
  const shades=[palette.mix(palette.color('paper'),palette.neutral(16),4/20),palette.color('paper'),palette.mix(palette.color('paperEdge'),palette.color('paper'),15/20),palette.mix(palette.color('paperEdge'),palette.color('paper'),10/20),palette.mix(palette.color('paper'),palette.tone('gold','ink'),3/20)];
  for(const [depth,name] of pageOrder.entries()) {
    const card=$(name+'-card'),tab=$(name+'-tab'),layer=$(name+'-page');
    card.hidden=false;
    card.setAttribute('aria-hidden',String(name!==activeSection));
    layer.style.setProperty('--page-depth',depth);
    layer.style.setProperty('--page-shade',shades[depth]);
    layer.style.zIndex=SECTIONS.length-depth;
    card.style.pointerEvents=name===activeSection?'auto':'none';
    layer.dataset.depth=card.dataset.depth=tab.dataset.depth=depth;
  }
}
function switchSection(section) {
  if(pageFlip){pageFlip.forEach(animation=>animation.cancel());pageFlip=null;}
  arrangePages();
  const targetDepth=pageOrder.indexOf(section),turnedPages=pageOrder.slice(0,targetDepth);
  const turnedShades=turnedPages.map(name=>$(name+'-page').style.getPropertyValue('--page-shade'));
  pageOrder=[...pageOrder.slice(targetDepth),...turnedPages];
  cancelParameterPause();interactionRegion=null;activeSection=section;
  setViewState('animation',{restart:true});
  arrangePages();
  for(const name of SECTIONS) {
    const selected=name===section;
    $(name+'-tab').setAttribute('aria-selected',String(selected));
    $(name+'-tab').tabIndex=selected?0:-1;
  }
  const tree=section==='tree';
  syncControls();buildActions();buildScene();updatePlayback();
  if(turnedPages.length&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const frames=[
      {transform:'perspective(var(--page-perspective)) rotateY(0deg)',opacity:1},
      {offset:.45,transform:'perspective(var(--page-perspective)) rotateY(-48deg)',opacity:1},
      {offset:.8,transform:'perspective(var(--page-perspective)) rotateY(-78deg)',opacity:1},
      {transform:'perspective(var(--page-perspective)) rotateY(-89deg)',opacity:0}
    ];
    pageFlip=turnedPages.map((name,depth)=>{
      const page=$(name+'-page');
      page.style.setProperty('--page-depth',depth);page.style.setProperty('--page-shade',turnedShades[depth]);page.style.zIndex=SECTIONS.length*2-depth;
      return page.animate(frames.map(frame=>({...frame,transformOrigin:'left center'})),{duration:650,easing:'cubic-bezier(.35,.05,.65,1)'});
    });
    const outward=pageFlip;
    Promise.all(outward.map(animation=>animation.finished)).then(()=>{
      if(pageFlip!==outward)return;
      outward.forEach(animation=>animation.cancel());arrangePages();
      const attachFrames=[
        {transform:'perspective(var(--page-perspective)) translateZ(-260px) scale(.72)',opacity:.55},
        {offset:.55,transform:'perspective(var(--page-perspective)) translateZ(-100px) scale(.88)',opacity:.85},
        {transform:'perspective(var(--page-perspective)) translateZ(0) scale(1)',opacity:1}
      ];
      pageFlip=turnedPages.map(name=>$(name+'-page').animate(attachFrames.map(frame=>({...frame,transformOrigin:`${$(name+'-card').clientWidth}px center`})),{duration:500,easing:'cubic-bezier(.45,0,.55,1)'}));
      const attaching=pageFlip;
      Promise.all(attaching.map(animation=>animation.finished)).then(()=>{
        if(pageFlip!==attaching)return;
        pageFlip=null;
        arrangePages();
      }).catch(()=>{});
    }).catch(()=>{});
  }
}
function renderTree() {
  const t=viewState==='rest'?1:progress;
  const next=actions.findIndex(action=>t<action.end),phase=next<0?actions.length-1:next;
  const action=actions[phase],local=Math.max(0,Math.min(1,(t-action.start)/(action.end-action.start||1)));
  treeLayers.forEach((layer,depth)=>{
    const expansion=depth*2,pruning=expansion+1,cut=phase>pruning?1:phase===pruning?local:0;
    const prune=Math.max(0,Math.min(1,(cut-.2)/.25));
    const cross=Math.min(1,cut/.15)*(1-Math.max(0,Math.min(1,(cut-.55)/.15)));
    const move=Math.max(0,Math.min(1,(cut-.7)/.2));
    const regroup=move*move*(3-2*move);
    const reveal=phase<expansion?0:phase===expansion?1-(1-Math.min(1,local*1.4))**3:1;
    set(layer.revealClip,{height:layer.revealHeight*reveal});
    set(layer.layer,{opacity:phase<expansion?0:1});
    set(layer.factorArrow,{opacity:reveal});
    set(layer.factor,{opacity:viewState==='rest'||phase===expansion||phase===pruning?1:.4});
    layer.factorBars.forEach(bar=>set(bar,{'fill-opacity':phase===expansion?.85:.55}));
    layer.nodes.forEach(node=>{
      const x=node.candidateX+(node.x-node.candidateX)*regroup,y=node.y-16*(1-reveal);
      const scale=node.candidateScale+(1-node.candidateScale)*(node.keep?regroup:0),shrink=node.keep?1:1-.4*prune;
      const w=node.w*scale*shrink,h=node.h*scale*shrink;
      set(node.edge,{d:treeCurve(node.parent.x,node.parent.y+node.parent.h/2+3,x,y-h/2-3),'stroke-opacity':(.12+.4*node.strength)*(node.keep?1:1-prune)});
      set(node.group,{opacity:reveal,transform:`translate(${x} ${y})`});
      set(node.shape,{x:-w/2,y:-h/2,width:w,height:h,rx:Math.min(config.treeNodeRadius*scale*shrink,w/2,h/2),opacity:node.keep?1:1-prune,'stroke-width':node.keep&&regroup?1.8:1.1});
      if(node.cross)set(node.cross,{opacity:cross});
    });
  });
  const finalPrune=config.U*2-1;
  set(treeOutputGroup,{opacity:phase>finalPrune?1:phase===finalPrune?Math.max(0,Math.min(1,(local-.9)/.1)):0});
  renderTimeline(phase,phase===actions.length-1?`Top-${config.topK}`:`${config.U-1-Math.floor(phase/2)} · ${phase%2?'裁剪':'展开'}`);
}
function stepPlayback(direction) {
  const index=indexAt(progress);
  cancelParameterPause();setViewState('interaction');
  if(activeSection==='heatmap'){
    heatmapHover=null;
    progress=heatmapProgress(Math.max(-1,Math.min(config.U*config.dp,heatmapFrame()+direction)));
  } else if(activeSection==='tree') {
    const next=Math.max(0,Math.min(actions.length-1,activeAction+direction));
    progress=Math.min(1,actions[next].start+.00001);
  } else {
    seekIndex(index+direction);return;
  }
  render();
}
function indexAt(t) {
  if(activeSection==='waveform') {
    const start=config.waveformRevealDuration/sectionDuration();
    t=(t-start)/(1-start)+1e-12;
  }
  return Math.max(0,Math.min(total-1,Math.floor(t*total)));
}
function indexProgress(index) {
  if(activeSection==='waveform')return (config.waveformRevealDuration+config.waveformScanDuration*index/total)/sectionDuration();
  return index/total;
}
function seekIndex(index) {
  cancelParameterPause();setViewState('interaction');
  progress=indexProgress(Math.max(0,Math.min(total-1,index)));render();
}
function render() {
  if(activeSection==='tree'){renderTree();return;}
  if(activeSection==='heatmap'){renderHeatmap();return;}
  if(activeSection==='regroup'){renderRegroup();return;}
  if(activeSection==='waveform'){renderWaveform();return;}
  const index=indexAt(progress),parts=digits(index),actionIndex=0,scanning=viewState!=='rest';
  for(const node of [highlight,scanLine,addressGroup])set(node,{opacity:scanning?1:0});
  if(index!==currentIndex) {
    currentIndex=index;
    for(let u=0;u<config.U;u++) {
      for(let d=0;d<config.dp;d++) {
        const selected=d===parts[u],nodes=sourceNodes[u].row[d];
        set(nodes.bar,{'fill-opacity':selected?1:.28});
        set(nodes.tag,{fill:selected?color(u):palette.neutral(6),'font-weight':selected?700:400,opacity:nodes.compactLabels&&!selected?0:1});
        nodes.bar.setAttribute('aria-pressed',String(selected));
      }
      const bar=sourceNodes[u].row[parts[u]].bar;
      const sx=Number(bar.getAttribute('x'))+Number(bar.getAttribute('width'))/2,sy=sourceNodes[u].arrowY;
      const multiplyX=chart.x+chart.width/2,outer=u===0||u===3,ex=multiplyX+(u>=2?(outer?-25:-9):(outer?25:9));
      routeNodes[u].setAttribute('d',roundedRoute(outer?[[sx,sy],[sx,multiplyY],[ex,multiplyY]]:[[sx,sy],[sx,multiplyY-40],[ex,multiplyY-40],[ex,multiplyY-23]]));
      addressNodes[u].textContent=binary(parts[u]);
    }
    const bin=Math.floor(index/binSize),x=chart.x+(index+.5)/total*chart.width;
    const step=chart.width/groups.length,y=chart.bottom-probabilities[index]/outputScaleMax*chart.plotHeight;
    bars.forEach((bar,i)=>set(bar,{'fill-opacity':scanning?(i===bin?1:topBars.has(i)?.65:diagram.alpha.low):.55}));
    set(highlight,{x:chart.x+bin*step});set(scanLine,{x1:x,x2:x});
    const startY=multiplyY+21,turnY=Math.min(multiplyY+65,(startY+y-8)/2);
    const multiplyX=chart.x+chart.width/2;
    set(outputRoute,{d:roundedRoute([[multiplyX,startY],[multiplyX,turnY],[x,turnY],[x,y-8]])});
    const margin=bits*config.U*20*config.diagramFontScale/100*.32+4;
    const addressX=Math.max(chart.x+margin,Math.min(chart.x+chart.width-margin,x));
    addressGroup.setAttribute('transform',`translate(${addressX} ${chart.bottom+43})`);
  }
  renderTimeline(actionIndex,index.toString(2).padStart(bits*config.U,'0'));
}
function renderTimeline(actionIndex,reference) {
  if(activeAction!==actionIndex) {
    activeAction=actionIndex;

  }
}
function buildActions() {
  const duration=sectionDuration();
  if(activeSection==='waveform') {
    const start=config.waveformRevealDuration/duration;
    actions=[{name:'逐层呈现',start:0,end:start,detail:'每行按 00 → 01 → 10 → 11 同步呈现因子与对应的周期柱，最后显示逐点乘积'},{name:'同步扫描',start,end:1,detail:'虚线对齐五行，子地址组成完整地址'}];
  } else if(activeSection!=='tree')actions=[{name:SECTION_NAMES[activeSection],start:0,end:1,detail:activeSection==='heatmap'?'依次激活四个因子的十六个取值，每个取值对应六十四个地址':'全地址从左向右连续扫描'}];
  else {
    const durations=Array.from({length:config.U*2},(_,i)=>i%2?config.treePruneDuration:config.treeExpandDuration).concat(config.treeHoldDuration);
    let elapsed=0;
    actions=durations.map((seconds,i)=>{
      const start=Math.min(1,elapsed/duration);elapsed+=seconds;
      return {
        name:i===config.U*2?'保持输出':`${i%2?'裁剪':'展开'} · 分片 ${config.U-1-Math.floor(i/2)}`,
        start,end:i===config.U*2?1:Math.min(1,elapsed/duration),
        detail:i===config.U*2?`蓝色输出保持 ${config.treeHoldDuration} 秒`:i%2?`保留乘积最大的 ${config.topK} 个节点`:'每个保留节点与当前因子的四个概率分别相乘'
      };
    });
  }
  activeAction=-1;
}
function syncControls(){
  $('topK').value=config.topK;$('topK-value').textContent=`Top-${config.topK}`;
  document.querySelectorAll('.topk-ticks span').forEach((tick,i)=>tick.classList.toggle('active',i+1===config.topK));
  const style=document.documentElement.style;
  style.setProperty('--animation-radius',config.animationRadius+'px');
  style.setProperty('--space',config.spacing+'px');
  style.setProperty('--interaction-aspect',config.interactionAspect);
  style.setProperty('--ui-font-scale',config.uiFontScale/100);layoutPages();
}
function updatePlayback(){document.querySelector('.animation-shell').dataset.viewState=viewState;}
function applyConfig(next,{regenerate=true,restart=false}={}) {
  config=next;if(restart)progress=0;
  scope.setCycleDuration?.(SECTIONS.reduce((seconds,section)=>seconds+sectionCycleDuration(section),0));
  previousTimestamp=null;
  syncControls();if(regenerate)generate();buildFactorEditors();buildActions();buildScene();updatePlayback();
}
function change(key,value) {
  config[key]=value;pauseForParameters();
  syncControls();buildActions();buildScene();
}
function togglePlay() {
  cancelParameterPause();interactionRegion=null;
  if(viewState==='animation'){setViewState('rest');render();}else resumeAnimation();
}
function frame(timestamp) {
  if(viewState==='interaction'&&interactionRegion?.hasAttribute('data-scan-factor')&&!document.hidden&&previousTimestamp!==null) {
    const stride=config.dp**Number(interactionRegion.dataset.scanFactor);
    const selected=Number(interactionRegion.dataset.scanValue),choices=Number(interactionRegion.dataset.scanChoices),position=progress*total;
    // Remove the fixed factor or group, advance through matches, then insert it again.
    const elapsed=Math.min(timestamp-previousTimestamp,100);
    const compact=(Math.floor(position/(stride*choices))*stride+position%stride+elapsed/1000/sectionDuration()*total)%(total/choices);
    progress=((Math.floor(compact/stride)*choices+selected)*stride+compact%stride)/total;
    render();
  }
  if(viewState==='animation'&&!document.hidden) {
    if(sectionSwitchAt!==null&&timestamp>=sectionSwitchAt) {
      if(repeatSection) {
        setViewState('animation',{restart:true});render();
      } else {
        if(activeSection===SECTIONS[SECTIONS.length-1]) {
          config.factors=null;generate();buildFactorEditors();
        }
        switchSection(nextSection());
      }
    } else if(previousTimestamp!==null&&progress<1) {
      const elapsed=Math.min(timestamp-previousTimestamp,100);
      progress=Math.min(1,progress+elapsed/1000/sectionDuration());
      if(progress>=1) {
        sectionSwitchAt=timestamp+config.sectionDelay*1000;
      }
      if(activeSection!=='heatmap')render();
    }
  }
  if(activeSection==='heatmap'&&!document.hidden) {
    if(previousTimestamp!==null)heatmapTime+=Math.min(timestamp-previousTimestamp,100);
    if(timestamp-heatmapLastFrame>=32) {
      heatmapLastFrame=timestamp;renderHeatmap();
    }
  }
  previousTimestamp=timestamp;requestAnimationFrame(frame);
}
const hoverSurfaces=SECTIONS.map(name=>$(name+'-card'));
const insidePage=target=>target&&hoverSurfaces.some(surface=>surface.contains(target));
for(const surface of hoverSurfaces) {
  surface.addEventListener('pointerenter',event=>{
    if(event.pointerType!=='mouse'||window.ramnetCompactInteractions.matches)return;
    pageHovered=true;refreshViewState();
  });
  surface.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||window.ramnetCompactInteractions.matches)return;
    pageHovered=true;
    if(!event.target.closest('[data-interaction-region]')){interactionRegion=null;refreshViewState();}
  });
  surface.addEventListener('pointerleave',event=>{
    if(event.pointerType!=='mouse'||insidePage(event.relatedTarget))return;
    pageHovered=false;interactionRegion=null;refreshViewState();
  });
}
const parameterPanel=$('distribution-interactions');
parameterPanel.addEventListener('pointerdown',event=>{
  if(!event.target.closest('input,.factor-divider,.factor-segment,.factor-value'))return;
  parameterPointers.add(event.pointerId);pauseForParameters();
},true);
for(const type of ['pointerup','pointercancel','lostpointercapture'])parameterPanel.addEventListener(type,event=>{
  if(!parameterPointers.delete(event.pointerId))return;
  scheduleParameterResume();refreshViewState();
},true);
const topK=$('topK'),topKHint=document.createElement('output');
topKHint.className='control-hint';topKHint.hidden=true;topKHint.setAttribute('aria-hidden','true');
topK.parentElement.append(topKHint);
const showTopKHint=(value=Number(topK.value))=>{
  topKHint.textContent=value;
  topKHint.style.left=`calc(8px + (100% - 16px) * ${(value-Number(topK.min))/(Number(topK.max)-Number(topK.min))})`;
  topKHint.hidden=false;
};
bindControlHint(topK,()=>showTopKHint(),()=>{topKHint.hidden=true;});
topK.addEventListener('pointermove',event=>{
  const bounds=topK.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-bounds.left-8)/(bounds.width-16)));
  showTopKHint(event.buttons?Number(topK.value):Math.round(Number(topK.min)+fraction*(Number(topK.max)-Number(topK.min))));
});
topK.addEventListener('input',()=>{change('topK',Number(topK.value));showTopKHint();});
for(const name of SECTIONS) {
  $(name+'-tab').addEventListener('click',()=>{if(activeSection!==name)switchSection(name);});
  $(name+'-tab').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const target=event.key==='Home'?SECTIONS[0]:event.key==='End'?SECTIONS[SECTIONS.length-1]:SECTIONS[(SECTIONS.indexOf(activeSection)+(event.key==='ArrowRight'?1:SECTIONS.length-1))%SECTIONS.length];
    switchSection(target);$(target+'-tab').focus();
  });
}
document.addEventListener('keydown',event=>{
  if(event.target.closest('input,select,textarea,button,summary,[role="button"],[role="slider"]'))return;
  if(event.code==='Space'){event.preventDefault();togglePlay();}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();stepPlayback(event.key==='ArrowRight'?1:-1);}
});
document.addEventListener('visibilitychange',()=>{previousTimestamp=null;});
const exhibitHost=document.body.getRootNode().host;
exhibitHost?.addEventListener('ramnet:content-layout',event=>{
  const {left,width}=event.detail;
  if(!Number.isFinite(left)||!Number.isFinite(width)||left<0||width<=0)return;
  articleLayout={left,width};
  document.documentElement.style.setProperty('--article-text-left',left+'px');
  document.documentElement.style.setProperty('--article-text-width',width+'px');
  layoutPages();buildScene();
});
window.ramnetCompactInteractions.addEventListener('change',()=>{
  pageHovered=false;interactionRegion=null;cancelParameterPause();
  setViewState('animation',{restart:true});layoutPages();buildScene();
});
arrangePages();applyConfig(config);scope.onAutoplayStart?.(event=>{
  if(!event.detail?.resumeCurrent){pageOrder=[...SECTIONS];switchSection('distribution');return;}
  cancelParameterPause();pageHovered=false;interactionRegion=null;
  if(viewState!=='animation')resumeAnimation();
  previousTimestamp=null;
  const remaining=progress<1?(1-progress)*sectionDuration()+config.sectionDelay:Math.max(0,(sectionSwitchAt-performance.now())/1000);
  const later=SECTIONS.slice(SECTIONS.indexOf(activeSection)+1).reduce((seconds,section)=>seconds+sectionCycleDuration(section),0);
  event.detail.remainingMs=(remaining+later+(repeatSection?sectionCycleDuration(activeSection):0))*1000;
  render();
});requestAnimationFrame(frame);
const cardScroll=document.querySelector('.card-scroll');
let cardScrollWidth=cardScroll.clientWidth;
new ResizeObserver(()=>{
  if(cardScroll.clientWidth===cardScrollWidth)return;
  cardScrollWidth=cardScroll.clientWidth;
  layoutPages();buildScene();
}).observe(cardScroll);
exhibitHost?.addEventListener('ramnet:fit',()=>{layoutPages();buildScene();});
};
if (document.body.classList.contains('exhibit-product_softmax')) window.RamnetRuntime.mountStandalone('product_softmax');
