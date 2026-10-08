window.RamnetAnimations ??= {};
window.RamnetAnimations.attn_cmp = function mount(scope) {
const {document, requestAnimationFrame, cancelAnimationFrame, translateText} = scope;
const palette=window.RamnetPalette;
'use strict';
const diagram=window.ramnetDiagramTheme;
    const $ = id => document.getElementById(id);
    const params = {sceneAspectRatio:4,count:20,ratio:.2,height:88,outputHeightRatio:1,outputGap:6,gap:8,distance:320,cachePadding:17,endpointGap:8,radius:3,lineWidth:2.8,panelRadius:18,framePadding:6,selectionOpacity:24,compressionRatio:.25,comparisonGap:32,backgroundPadding:16,sparseGroupSize:4,sparseGroupGap:24,linearCacheCount:4,ramnetCacheCount:12,ramnetTopK:2,red:diagram.colors.red,green:diagram.colors.green,gray:palette.neutral(12),processedColor:palette.neutral(8),fullColor:diagram.colors.pink,compressedColor:diagram.colors.cyan,sparseColor:diagram.colors.orange,linearColor:diagram.colors.purple,ramnetColor:diagram.colors.sky,packetOpacity:diagram.alpha.strong*100,overlapFade:128,writeTime:.3,scanTime:.1,readTime:.3,blankTime:.1};
    let actions = [], total = 0, time = 0, lastStamp = null, currentIndex = -1, geometries=[];
    let randomState=Date.now()>>>0||1;
    const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
    const ease = t => {t=clamp(t,0,1);return t*t*(3-2*t);};
    const mix = (a,b,t) => {
      const av=parseInt(a.slice(1),16),bv=parseInt(b.slice(1),16);
      return '#'+[16,8,0].map(s=>Math.round(((av>>s)&255)*(1-t)+((bv>>s)&255)*t).toString(16).padStart(2,'0')).join('');
    };
    function paletteFor(base){
      return {packet:base,cache:base,background:diagram.rgba(base,diagram.alpha.surface),border:diagram.rgba(base,diagram.alpha.border)};
    }
    const svgElement = (name,attributes,parent) => {const el=document.createElementNS('http://www.w3.org/2000/svg',name);Object.entries(attributes).forEach(([k,v])=>el.setAttribute(k,v));parent.append(el);return el;};
    const formatTime = t => t.toFixed(2).padStart(5,'0');

    function random(){
      randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;
      return (randomState>>>0)/4294967296;
    }
    function attentionVector(){
      const vector=Array.from({length:8},()=>2*random()-1);
      const scale=(2+random())/Math.hypot(...vector);
      return vector.map(value=>value*scale);
    }
    function attentionWeights(count,topK=count){
      // Norms in [2, 3] and scaled dot products produce softer attention weights.
      const query=attentionVector();
      const logits=Array.from({length:count},()=>{
        const key=attentionVector();
        return key.reduce((dot,value,i)=>dot+query[i]*value,0)/Math.sqrt(query.length);
      });
      const peak=Math.max(...logits),scores=logits.map(logit=>Math.exp(logit-peak));
      const sum=scores.reduce((total,score)=>total+score,0);
      const ranked=scores.map((score,index)=>({index,weight:score/sum})).sort((a,b)=>b.weight-a.weight);
      const weights=Array(count).fill(0);
      ranked.slice(0,topK).forEach(({index,weight})=>{weights[index]=weight;});
      return weights;
    }
    function randomizeAction(a){
      if(a.kind==='read'){
        a.cache=Math.floor(random()*(a.token+1));
        a.historyWeights=attentionWeights(a.token+1);
        const start=Math.floor(a.cache/params.sparseGroupSize)*params.sparseGroupSize;
        const groupWeights=attentionWeights(Math.min(params.sparseGroupSize,a.token+1-start));
        a.sparseWeights=Array(a.token+1).fill(0);
        groupWeights.forEach((weight,i)=>{a.sparseWeights[start+i]=weight;});
      }
      if(a.kind==='write'||a.kind==='read'){
        a.weights=attentionWeights(params.linearCacheCount);a.ramnetWeights=attentionWeights(params.ramnetCacheCount,params.ramnetTopK);
      }
    }
    function buildActions(){
      actions=[];let start=0;
      for(let i=0;i<params.count;i++){
        actions.push({kind:'write',token:i,start,duration:params.writeTime});start+=params.writeTime;
        actions.push({kind:'scan',token:i,start,duration:params.scanTime});start+=params.scanTime;
        actions.push({kind:'read',token:i,start,duration:params.readTime});start+=params.readTime;
        if(i<params.count-1&&params.blankTime>0){actions.push({kind:'blank',token:i,start,duration:params.blankTime});start+=params.blankTime;}
      }
      total=start;
      currentIndex=-1;
    }
    function cacheOffset(g,index){
      return index*(g.cacheW+params.gap)+(g.sparse?Math.floor(index/params.sparseGroupSize)*params.sparseGroupGap:0);
    }
    function buildScene(){
      const w=params.height*params.ratio,h=params.height,span=params.count*w+(params.count-1)*params.gap;
      const outputH=w*params.outputHeightRatio;
      const padding=params.cachePadding,outer=params.backgroundPadding+2,titleHeight=120,descriptionHeight=140;
      const cacheMargin=Math.max(padding,params.framePadding);
      const viewH=h*2+params.outputGap+outputH+params.distance+cacheMargin+outer*2+titleHeight+descriptionHeight;
      const y=outer+titleHeight,outputY=y+h+params.outputGap,cacheY=outputY+outputH+params.distance;
      const panels=[
        {scale:1,base:params.fullColor,name:'Full cache',label:'Full Attention',description:['Stores every token in the cache.','Each query reads the full history.']},
        {scale:params.compressionRatio,base:params.compressedColor,name:'Compressed cache',label:'KV Quant / MLA',description:['Compresses historical entries.','The cache still grows with context.']},
        {scale:1,base:params.sparseColor,name:'Sparse cache',label:'Sparse Attention',description:['Reads selected historical positions','from a growing KV cache.'],sparse:true},
        {scale:1,base:params.linearColor,name:'Linear cache',label:'Linear Attention',description:['Summarizes history in a fixed state.','Reads and writes the state densely.'],linear:true},
        {scale:1,base:params.ramnetColor,name:'RAM-Net cache',label:'RAM-Net',description:['Keeps a fixed array of memory slots.','Reads and writes only a selected few.'],linear:true,ramnet:true}
      ];
      for(const panel of panels){
        const count=panel.linear?(panel.ramnet?params.ramnetCacheCount:params.linearCacheCount):params.count;
        const cacheSpan=count*w*panel.scale+(count-1)*params.gap+(panel.sparse?Math.floor((count-1)/params.sparseGroupSize)*params.sparseGroupGap:0);
        panel.viewW=Math.max(span,cacheSpan+cacheMargin*2)+outer*2;
      }
      const panelWidth=Math.max(...panels.map(panel=>panel.viewW));
      const naturalW=panelWidth*panels.length+params.comparisonGap*(panels.length-1)+32,naturalH=viewH+32;
      const totalW=naturalW,totalH=naturalH;
      const offsetX=(totalW-naturalW)/2,offsetY=(totalH-naturalH)/2;
      $('scene').setAttribute('viewBox',`0 0 ${totalW} ${totalH}`);
      $('scene').style.aspectRatio=String(totalW/totalH);
      $('drawing').replaceChildren();geometries=[];
      let panelX=16+offsetX;
      panels.forEach(panel=>{
        const viewW=panelWidth,x=(viewW-span)/2;
        const root=svgElement('g',{transform:`translate(${panelX},16)`,role:'group','aria-label':panel.name},$('drawing'));
        panelX+=viewW+params.comparisonGap;
        const colors=paletteFor(panel.base),cacheW=w*panel.scale;
        const fixedCount=panel.ramnet?params.ramnetCacheCount:params.linearCacheCount;

        const content=svgElement('g',{transform:`translate(0,${offsetY})`},root);
        svgElement('rect',{x:0,y:0,width:viewW,height:viewH,rx:params.panelRadius,fill:mix(palette.color('paper'),panel.base,diagram.alpha.surface),stroke:mix(palette.color('paper'),panel.base,diagram.alpha.border),'stroke-width':2,class:'mechanism-card'},content);
        svgElement('text',{x:viewW/2,y:outer+62,class:'panel-title',fill:diagram.text(panel.base),'text-anchor':'middle'},content).textContent=translateText(panel.label);
        const description=svgElement('text',{class:'panel-description',fill:palette.neutral(3),'text-anchor':'middle'},content);
        panel.description.forEach((line,index)=>svgElement('tspan',{x:viewW/2,y:cacheY+h+cacheMargin+66+index*40},description).textContent=translateText(line));
        const layers={};for(const name of ['backdrop','links','tokens','module','packets'])layers[name]=svgElement('g',{},content);
        const g={w,h,outputH,outputY,cacheW,x,y,center:viewW/2,cacheX:viewW/2,cacheY,colors,root,sparse:!!panel.sparse,linear:!!panel.linear,ramnet:!!panel.ramnet,rects:[],outputs:[],caches:[],paths:[],packets:[],selections:[],tokenObstacles:[],obstacles:[]};
        g.frame=svgElement('rect',{x:viewW/2-padding,y:cacheY-padding,width:padding*2,height:h+padding*2,rx:params.radius+8,fill:colors.background,stroke:colors.border,'stroke-width':1.6,filter:'url(#shadow)',opacity:0},layers.backdrop);
        g.pending=svgElement('rect',{x:viewW/2-cacheW/2,y:cacheY,width:cacheW,height:h,rx:Math.min(params.radius,cacheW/2,h/2),fill:'none',stroke:colors.border,'stroke-width':1.6,'stroke-dasharray':'3 4',opacity:0},layers.module);
        for(let i=0;i<params.count;i++){
          const tx=x+i*(w+params.gap);
          g.rects.push(svgElement('rect',{x:tx,y,width:w,height:h,rx:Math.min(params.radius,w/2,h/2),fill:params.processedColor},layers.tokens));
          g.tokenObstacles.push({x:tx,y,w,h});
          g.outputs.push(svgElement('rect',{x:tx,y:outputY,width:w,height:outputH,rx:Math.min(params.radius,w/2,outputH/2),fill:params.gray},layers.tokens));
          g.tokenObstacles.push({x:tx,y:outputY,w,h:outputH});
        }
        for(let i=0;i<(g.linear?fixedCount:params.count);i++){
          const tx=x+i*(w+params.gap);
          g.caches.push(svgElement('rect',{x:tx,y:cacheY,width:cacheW,height:h,rx:Math.min(params.radius,cacheW/2,h/2),fill:colors.cache,'fill-opacity':diagram.alpha.strong,opacity:0},layers.module));
          if(g.ramnet)g.selections.push(svgElement('rect',{x:tx-params.framePadding,y:cacheY-params.framePadding,width:cacheW+params.framePadding*2,height:h+params.framePadding*2,rx:params.radius+params.framePadding,fill:params.green,'fill-opacity':0,stroke:params.green,'stroke-width':params.lineWidth,opacity:0},layers.module));
        }
        g.selection=svgElement('rect',{x:x-params.framePadding,y:cacheY-params.framePadding,width:cacheW+params.framePadding*2,height:h+params.framePadding*2,rx:params.radius+params.framePadding,fill:params.green,'fill-opacity':0,stroke:params.green,'stroke-width':params.lineWidth,opacity:0},layers.module);
        for(let i=0;i<(g.linear?fixedCount:params.count)*2;i++){
          g.paths.push(svgElement('path',{fill:'none','stroke-width':params.lineWidth,'stroke-linecap':'round'},layers.links));
          const packet=g.rects[0].cloneNode();layers.packets.append(packet);g.packets.push(packet);
        }
        geometries.push(g);
      });
    }
    function connection(g,index,token,cache,color,packetProgress,opacity,strength=1){
      const downward=index%2===0;
      const tx=g.x+token*(g.w+params.gap)+g.w/2;
      const ty=downward?g.y+g.h+Math.min(params.endpointGap,params.outputGap/2):g.outputY+g.outputH+params.endpointGap;
      const mx=Number(g.caches[cache].getAttribute('x'))+g.cacheW/2,my=g.cacheY-params.endpointGap;
      const [start,end]=downward?[[tx,ty],[mx,my]]:[[mx,my],[tx,ty]];
      // Share the same weight encoding for every read and write; zero means no access.
      const path=g.paths[index];path.setAttribute('d',`M${start} L${end}`);path.setAttribute('stroke',mix(color,diagram.text(color),.55*strength));
      path.setAttribute('opacity',opacity*(strength>0?.55+.25*strength:0));
      path.setAttribute('stroke-width',params.lineWidth*(1+.8*strength));
      const packet=g.packets[index];packet.setAttribute('fill',g.colors.packet);
      const t=ease(packetProgress),packetW=downward?g.w+(g.cacheW-g.w)*t:g.cacheW+(g.w-g.cacheW)*t;
      const packetH=downward?g.h:g.h+(g.outputH-g.h)*t;
      const tokenCenter=[tx,downward?g.y+g.h/2:g.outputY+g.outputH/2],attnTarget=[mx,g.cacheY+g.h/2];
      const [packetStart,packetEnd]=downward?[tokenCenter,attnTarget]:[attnTarget,tokenCenter];
      const x=packetStart[0]+(packetEnd[0]-packetStart[0])*t-packetW/2;
      const y=packetStart[1]+(packetEnd[1]-packetStart[1])*t-packetH/2;
      const visibility=ease(packetProgress/.3)*ease((1-packetProgress)/.3);
      let proximity=1;
      // Keep a faint tail after contact and finish fading at the trajectory endpoint.
      for(const obstacle of g.obstacles){
        const gapX=Math.max(obstacle.x-x-packetW,x-obstacle.x-obstacle.w,0);
        const gapY=Math.max(obstacle.y-y-packetH,y-obstacle.y-obstacle.h,0);
        proximity=Math.min(proximity,.01+.99*ease(Math.hypot(gapX,gapY)/params.overlapFade));
      }
      packet.setAttribute('width',packetW);packet.setAttribute('height',packetH);packet.setAttribute('rx',Math.min(params.radius,packetW/2,packetH/2));
      packet.setAttribute('opacity',visibility*proximity*params.packetOpacity/100*strength);packet.setAttribute('x',x);packet.setAttribute('y',y);
    }
    function renderPanel(g,a,p){
      const write=a.kind==='write',read=a.kind==='read'&&p<1,scan=a.kind==='scan';
      const selectionFill=params.selectionOpacity/100*(scan?1:read?1-ease(p/.45):0);
      const arrival=write?ease((p-.72)/.28):1,cacheCount=g.linear?g.caches.length:a.token+1;
      const probabilities=g.ramnet?a.ramnetWeights:g.linear?a.weights:g.sparse?a.sparseWeights:a.historyWeights;
      const peak=probabilities?Math.max(...probabilities):1,weights=probabilities?.map(weight=>weight/peak);
      const routedWeights=g.ramnet&&scan?actions.find(candidate=>candidate.kind==='read'&&candidate.token===a.token).ramnetWeights:weights;
      const cacheSpan=cacheOffset(g,cacheCount-1)+g.cacheW;
      const selectedCache=read?a.cache:scan?actions.find(candidate=>candidate.kind==='read'&&candidate.token===a.token).cache:0;
      g.cacheX=g.center-cacheSpan/2;
      g.frame.setAttribute('x',g.cacheX-params.cachePadding);g.frame.setAttribute('width',cacheSpan+params.cachePadding*2);g.frame.setAttribute('opacity',cacheCount>0?1:0);
      g.obstacles=[...g.tokenObstacles];
      for(let i=0;i<params.count;i++){
        let color=i<a.token||((!write||p===1)&&i===a.token)?params.gray:params.processedColor;
        if(write&&p<1&&i===a.token)color=params.red;
        g.rects[i].setAttribute('fill',color);
        const generated=i<a.token||(i===a.token&&(a.kind==='blank'||(a.kind==='read'&&p===1)));
        g.outputs[i].setAttribute('fill',read&&i===a.token?params.green:generated?g.colors.packet:params.gray);
      }
      for(let i=0;i<g.caches.length;i++){
        const stored=g.linear?1:i<a.token?1:i===a.token?arrival:0;
        const cacheX=g.cacheX+cacheOffset(g,i);
        g.caches[i].setAttribute('x',cacheX);
        g.caches[i].setAttribute('opacity',stored);
        const strength=read||(g.linear&&write)?weights[i]||0:1,activeRead=read&&strength>0&&i<cacheCount;
        const color=activeRead?mix(g.colors.cache,params.green,.3*strength):g.linear&&write?mix(g.colors.cache,params.red,.25*strength*arrival):g.colors.cache;
        g.caches[i].setAttribute('fill',color);
        g.caches[i].setAttribute('stroke',activeRead?params.green:'none');
        g.caches[i].setAttribute('stroke-opacity',strength);
        g.caches[i].setAttribute('stroke-width',params.lineWidth);
        if(g.ramnet){
          g.selections[i].setAttribute('x',cacheX-params.framePadding);
          g.selections[i].setAttribute('opacity',(scan||read)&&routedWeights[i]>0?1:0);
          g.selections[i].setAttribute('fill-opacity',selectionFill);
        }
        if(g.linear||i<=a.token)g.obstacles.push({x:cacheX,y:g.cacheY,w:g.cacheW,h:g.h});
      }
      g.pending.setAttribute('x',g.cacheX+cacheOffset(g,a.token));
      g.pending.setAttribute('opacity',!g.linear&&write?(1-arrival)*.65:0);
      if(g.linear){
        for(let i=0;i<cacheCount;i++){
          const strength=write||read?weights[i]:1;
          connection(g,i*2,a.token,i,params.red,write?p:1,write&&p<1?.9:0,strength);
          connection(g,i*2+1,a.token,i,params.green,read?p:1,read?.9:0,strength);
        }
      }else{
        for(let i=0;i<g.caches.length;i++){
          connection(g,i*2,a.token,i,params.red,write&&i===a.token?p:1,write&&p<1&&i===a.token?.9:0);
          connection(g,i*2+1,a.token,i,params.green,read?p:1,read?.9:0,read?weights[i]||0:0);
        }
      }
      const groupStart=g.sparse?Math.floor(selectedCache/params.sparseGroupSize)*params.sparseGroupSize:0;
      const groupEnd=g.sparse?Math.min(groupStart+params.sparseGroupSize,cacheCount):cacheCount;
      const selectionX=g.cacheX+cacheOffset(g,groupStart);
      const selectionSpan=cacheOffset(g,groupEnd-1)-cacheOffset(g,groupStart)+g.cacheW;
      g.selection.setAttribute('x',selectionX-params.framePadding);
      g.selection.setAttribute('width',selectionSpan+params.framePadding*2);
      g.selection.setAttribute('opacity',!g.ramnet&&(scan||read)?1:0);
      g.selection.setAttribute('fill-opacity',selectionFill);
    }
    function render(){
      const index=Math.max(0,actions.findIndex((a,i)=>time<a.start+a.duration||i===actions.length-1)),a=actions[index];
      const p=time>=total?1:clamp((time-a.start)/Math.max(a.duration,.001),0,1);
      if(index!==currentIndex){
        const previous=actions[currentIndex];
        if(a.kind==='write')randomizeAction(a);
        else if(a.kind==='scan')randomizeAction(actions.find(candidate=>candidate.kind==='read'&&candidate.token===a.token));
        else if(a.kind==='read'&&(previous?.kind!=='scan'||previous.token!==a.token))randomizeAction(a);
      }
      for(const g of geometries)renderPanel(g,a,p);
      currentIndex=index;
    }
    function frame(stamp){
      if(lastStamp!==null){time+=Math.min((stamp-lastStamp)/1000,.1);if(time>=total){time%=total;currentIndex=-1;}render();}
      lastStamp=stamp;requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange',()=>{lastStamp=null;});
    document.documentElement.style.setProperty('--scene-aspect-ratio',params.sceneAspectRatio);
    buildActions();scope.setCycleDuration?.(total);buildScene();render();requestAnimationFrame(frame);
    scope.onAutoplayStart?.(event=>{
      if(event.detail?.resumeCurrent)event.detail.remainingMs=Math.max(0,(total-time)*1000);
      else{time=0;currentIndex=-1;}
      lastStamp=null;render();
    });
};
if (document.body.classList.contains('exhibit-attn_cmp')) window.RamnetRuntime.mountStandalone('attn_cmp');
