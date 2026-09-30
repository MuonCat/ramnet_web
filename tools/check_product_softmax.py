"""Check sec3 state transitions in Chrome without third-party packages."""

import html
import json
from pathlib import Path
import re
import subprocess
import tempfile

from check_site import CHROME, ROOT


INSPECTOR = """
window.sec3StateCheck={
  tick(){window.sec3CheckFrame(performance.now());},
  advance(ms){previousTimestamp=performance.now()-ms;window.sec3CheckFrame(performance.now());},
  end(){progress=1;sectionSwitchAt=performance.now();window.sec3CheckFrame(performance.now());},
  remaining(seconds){progress=1-seconds*sectionSpeed()/sectionDuration();sectionSwitchAt=null;currentIndex=-1;render();},
  uniform(){applyConfig({...config,factors:Array.from({length:config.U},()=>Array(config.dp).fill(1/config.dp))});},
  finish(){progress=1;sectionSwitchAt=performance.now()+100;render();},
  read(){
    const factors=activeSection==='distribution'?sourceNodes.flatMap(item=>item.row.map(pair=>pair.bar)):
      activeSection==='tree'?treeLayers.flatMap(layer=>layer.factorBars):
      activeSection==='heatmap'?heatmapSources.flat():
      activeSection==='regroup'?regroupSources.flat():waveformRows.flatMap(row=>row.sourceBars);
    const overlays=activeSection==='distribution'?[highlight,scanLine,addressGroup]:
      activeSection==='regroup'?[...Object.values(regroupStrips).map(strip=>strip.selection),
        ...Object.values(regroupPanels).flatMap(panel=>[panel.rowGuide,panel.columnGuide,panel.selection])]:
      activeSection==='waveform'?[waveformReadout]:[];
    return {section:activeSection,progress,index:indexAt(progress),parts:digits(indexAt(progress)),state:viewState,
      overlays:overlays.map(node=>Number(node.getAttribute('opacity'))),
      factorLevels:factors.map(node=>node.getAttribute('fill-opacity')),
      treeComplete:activeSection==='tree'?Number(treeOutputGroup.getAttribute('opacity')):1,
      waveformComplete:activeSection==='waveform'?waveformRows.every(row=>Number(row.group.getAttribute('opacity'))===1):true,
      activePoints:activeSection==='heatmap'?heatmapNodes.filter(item=>item.strength>0&&item.node.getAttribute('fill')!==probabilityAppearance(outputColor(),item.strength).fill).length:0,
      pointOpacities:activeSection==='heatmap'?heatmapNodes.map(item=>Number(item.node.getAttribute('fill-opacity'))):[],
      slotProbabilities:probabilities,
      rotation:heatmapTime,repeat:repeatSection,pending:sectionSwitchAt!==null};
  }
};
"""
CHECKS = """
<script>
window.stateErrors=[];window.sec3Transitions=[];
addEventListener('error',event=>stateErrors.push(event.message));
addEventListener('unhandledrejection',event=>stateErrors.push(String(event.reason)));
addEventListener('load',()=>setTimeout(async()=>{
  const results=[],shell=document.querySelector('.animation-shell'),topK=document.getElementById('topK');
  const state=()=>shell.dataset.viewState;
  const read=()=>sec3StateCheck.read();
  const page=()=>document.getElementById(read().section+'-card');
  const assert=(test,message)=>{if(!test)throw Error(message+' '+JSON.stringify(read()));};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const pointer=(node,type,relatedTarget=null,fraction=.6)=>{
    const bounds=node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent(type,{pointerType:'mouse',pointerId:1,
      clientX:bounds.x+bounds.width*fraction,clientY:bounds.y+bounds.height*.6,
      relatedTarget,bubbles:!['pointerenter','pointerleave'].includes(type)}));
  };
  const topChange=()=>{topK.value=Number(topK.value)===8?'7':'8';topK.dispatchEvent(new Event('input',{bubbles:true}));};
  const probabilityColorCheck=(node,strength)=>{
    if(read().section==='heatmap'){
      const channels=node.getAttribute('fill').match(/[0-9.]+/g).map(Number),weight=Math.sqrt(strength);
      assert(Math.abs(Number(node.getAttribute('fill-opacity'))-(.6+.35*weight))<1e-9,'Joint opacity must map from 60% to 95%');
      assert(Math.abs(channels[1]-(8+84*weight))<1e-9&&Math.abs(channels[2]-(70-22*weight))<1e-9,
        'Joint saturation and lightness must preserve normalized probability differences');
      return;
    }
    const weight=Math.sqrt(.12+.88*strength),darken=.92;
    assert(Math.abs(Number(node.getAttribute('fill-opacity'))-weight)<1e-9,'Opacity must share the square-root mapping');
    const paper=document.getElementById(read().section+'-page').style.getPropertyValue('--page-shade');
    const base=window.ramnetDiagramTheme.colors.sky;
    const channels=node.getAttribute('fill').match(/[0-9.]+/g).map(Number);
    [1,3,5].forEach((offset,i)=>{
      const background=parseInt(paper.slice(offset,offset+2),16),target=parseInt(base.slice(offset,offset+2),16)*darken;
      assert(Math.abs(channels[i]-(background+(target-background)*weight))<=.501,
        'Color tint must share the square-root mapping');
    });
  };
  const staticCheck=name=>{
    const visual=read();
    assert(state()==='rest',name+': expected resting state');
    assert(visual.overlays.every(value=>value===0),name+': selection remained visible');
    assert(new Set(visual.factorLevels).size===1,name+': factor highlight remained visible');
    assert(visual.activePoints===0,name+': slice highlight remained visible');
    assert(visual.treeComplete===1&&visual.waveformComplete,name+': static diagram is incomplete');
  };
  try {
    for(const name of ['distribution','tree','heatmap','regroup','waveform']){
      document.getElementById(name+'-tab').click();
      assert(state()==='animation','Tab should start animation: '+name);
      const directRegion=document.getElementById(name==='distribution'?'scene':name+'-scene').querySelector('[data-interaction-region]');
      const transitionStart=sec3Transitions.length;
      pointer(directRegion,'pointerenter');
      assert(sec3Transitions.slice(transitionStart).map(item=>item.state).join(',')==='rest,interaction',
        name+': direct interaction entry skipped rest');
      const nextTab=['distribution','tree','heatmap','regroup','waveform'];
      document.getElementById(nextTab[(nextTab.indexOf(name)+1)%nextTab.length]+'-tab').click();
      assert(sec3Transitions.slice(transitionStart,transitionStart+4).map(item=>item.state).join(',')==='rest,interaction,rest,animation',
        name+': tab switch from interaction skipped rest');
      document.getElementById(name+'-tab').click();
      const tab=document.getElementById(name+'-tab');
      pointer(tab,'pointerenter');pointer(tab,'pointermove');
      pointer(document.querySelector('.compact-tabs'),'pointerenter');
      assert(state()==='animation',name+': tab hover paused animation');
      pointer(page(),'pointerenter');
      pointer(page(),'pointerleave',tab);
      pointer(tab,'pointermove');
      assert(state()==='animation',name+': leaving the diagram for a tab should resume animation');
      pointer(tab,'pointerleave');
      sec3StateCheck.tick();await wait(80);sec3StateCheck.tick();
      assert(read().progress>0,name+': animation clock did not advance');
      pointer(page(),'pointerenter');
      staticCheck(name);
      sec3StateCheck.tick();
      const before=read();
      await wait(180);sec3StateCheck.tick();
      assert(read().progress===before.progress,name+': resting scan advanced');
      assert(name==='heatmap'?read().rotation>before.rotation:read().rotation===before.rotation,
        name+': unexpected resting rotation');
      staticCheck(name);
      pointer(page(),'pointerleave');
      assert(state()==='animation'&&read().section===name&&read().progress===before.progress,
        name+': hover-only exit should continue from the paused position');
      pointer(page(),'pointerenter');
      const region=document.getElementById(name==='distribution'?'scene':name+'-scene').querySelector('[data-interaction-region]:not([data-scan-factor])');
      assert(region,name+': no interaction region');
      pointer(region,'pointerenter');
      assert(state()==='interaction',name+': hover did not enter interaction');
      const interacting=read();sec3StateCheck.tick();
      await wait(120);sec3StateCheck.tick();
      assert(state()==='interaction'&&read().progress===interacting.progress,name+': interaction resumed on its own');
      assert(name==='heatmap'?read().rotation>interacting.rotation:read().rotation===interacting.rotation,
        name+': unexpected interaction rotation');
      assert(read().activePoints===interacting.activePoints,name+': selected slice changed while rotating');
      pointer(region,'pointerleave',page());
      staticCheck(name);
      pointer(page(),'pointerleave');
      assert(state()==='animation'&&read().section===name&&read().progress===interacting.progress,
        name+': diagram interaction should continue from its selected position');
      document.getElementById(name+'-tab').click();

      sec3StateCheck.finish();
      topChange();
      staticCheck(name);
      assert(!read().pending,name+': old page-end timer remained active');
      await wait(1150);
      assert(read().section===name&&state()==='animation'&&read().progress===1&&read().repeat,
        name+': end-of-animation parameter edit did not schedule another cycle');
      sec3StateCheck.end();
      assert(read().section===name&&read().progress===0&&!read().repeat,name+': extra cycle did not start');

      pointer(page(),'pointerenter');
      const newRegion=document.getElementById(name==='distribution'?'scene':name+'-scene').querySelector('[data-interaction-region]');
      pointer(newRegion,'pointerenter');
      const factor=document.querySelector('.factor-value');
      factor.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));
      staticCheck(name);
      pointer(page(),'pointerenter');
      await wait(1150);
      assert(state()==='rest',name+': parameter cooldown overrode page hover');
      const editedProgress=read().progress;
      pointer(page(),'pointerleave');
      assert(state()==='animation'&&read().section===name&&read().progress===editedProgress,
        name+': a later parameter edit should preserve the current position');

      results.push(name+': hover and edits continue; edits at the end add one cycle');
    }

    pointer(topK,'pointerdown');topChange();
    await wait(1250);
    assert(state()==='rest','Holding a parameter control must stay resting');
    pointer(topK,'pointerup');
    await wait(550);topChange();
    await wait(550);
    assert(state()==='rest','Repeated input must extend the cooldown');
    await wait(550);
    assert(state()==='animation','Parameter release did not resume animation');
    results.push('Parameter hold, release, and repeated-input cooldown');

    topChange();
    pointer(page(),'pointerenter');
    const region=document.getElementById('waveform-scene').querySelector('[data-interaction-region]');
    pointer(region,'pointerenter');
    await wait(1150);
    assert(state()==='interaction','Old parameter timer interrupted a new hover');
    pointer(region,'pointerleave',page());pointer(page(),'pointerleave');
    assert(read().section==='waveform'&&state()==='animation','Diagram exit should continue the current tab');
    topChange();
    document.getElementById('regroup-tab').click();
    assert(state()==='animation'&&read().section==='regroup','Tab switch failed during parameter cooldown');
    await wait(1150);
    assert(state()==='animation'&&read().section==='regroup','Old cooldown interrupted a new tab');
    results.push('Hover and tab changes cancel stale cooldown events');

    document.getElementById('heatmap-tab').click();
    let jointFill=null;
    for(const k of [1,8,16]){
      topK.value=k;topK.dispatchEvent(new Event('input',{bubbles:true}));
      const probabilities=read().slotProbabilities,min=Math.min(...probabilities),max=Math.max(...probabilities);
      const expected=probabilities.map((_,i)=>i).sort((a,b)=>probabilities[b]-probabilities[a]||a-b).slice(0,k).sort((a,b)=>a-b);
      const points=[...document.querySelectorAll('#heatmap-scene circle[data-slot]')].sort((a,b)=>Number(a.dataset.slot)-Number(b.dataset.slot));
      const selected=points.filter(node=>node.dataset.topK==='true');
      assert(selected.map(node=>Number(node.dataset.slot)).join(',')===expected.join(','),'Joint Top-K ranking is incorrect');
      assert(selected.every(node=>node.getAttribute('stroke')==='#202020'&&Number(node.getAttribute('stroke-opacity'))>.9),
        'Joint Top-K must use black outlines');
      const fill=points.map(node=>Number(node.getAttribute('fill-opacity')));
      points.forEach((node,i)=>probabilityColorCheck(node,max===min?.5:(probabilities[i]-min)/(max-min)));
      assert(jointFill===null||fill.join(',')===jointFill,'Changing Joint Top-K changed probability colors');
      jointFill=fill.join(',');
    }
    results.push('Joint uses 60%-95% opacity and black Top-K outlines; probability controls saturation and lightness');
    for(const factor of document.querySelectorAll('.factor-editor')){
      factor.querySelector('.factor-value').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    }
    const oneHot=()=>{
      const opacity=read().pointOpacities;
      const saturation=[...document.querySelectorAll('#heatmap-scene circle[data-slot]')]
        .map(node=>Number(node.getAttribute('fill').split(' ')[1].replace('%','')));
      assert(opacity.filter(value=>Math.abs(value-.95)<1e-9).length===1,'The strongest point should have 95% opacity');
      assert(opacity.filter(value=>Math.abs(value-.6)<1e-9).length===255,'The weakest points should have 60% opacity');
      assert(saturation.filter(value=>value===92).length===1,'One-hot should have exactly one saturated point');
      assert(saturation.filter(value=>value===8).length===255,'Zero-probability points should be neutral and visible');
    };
    staticCheck('one-hot heatmap');oneHot();
    pointer(page(),'pointerenter');
    const factorRegion=document.getElementById('heatmap-scene').querySelector('[data-interaction-region]');
    pointer(factorRegion,'pointerenter',null,.2);oneHot();
    assert(read().activePoints===1,'Slice highlighting must preserve one-hot contrast');
    pointer(factorRegion,'pointerleave',page());pointer(page(),'pointerleave');
    results.push('One-hot probabilities remain distinct in resting and highlighted slices');

    document.getElementById('distribution-tab').click();
    sec3StateCheck.finish();
    pointer(page(),'pointerenter');
    await wait(200);sec3StateCheck.tick();
    assert(read().section==='distribution'&&state()==='rest','Hover must pause a pending page turn');
    pointer(page(),'pointerleave');
    assert(read().section==='distribution'&&read().progress===1&&read().pending,
      'Hover-only exit at the end should restore the pending page turn');
    await wait(150);sec3StateCheck.tick();
    assert(read().section==='tree'&&state()==='animation','Restored page turn did not complete');
    results.push('Hover-only exit preserves playback position and pending page turns');
    document.getElementById('distribution-tab').click();
    for(const next of ['tree','heatmap','regroup','waveform','distribution']){
      sec3StateCheck.finish();
      await wait(300);sec3StateCheck.tick();
      assert(read().section===next&&state()==='animation','Automatic five-tab cycle failed at '+next);
    }
    results.push('Automatic cycle includes all five tabs');
    for(const name of ['distribution','regroup']){
      document.getElementById(name+'-tab').click();
      const scene=document.getElementById(name==='distribution'?'scene':'regroup-scene');
      for(const factor of scene.querySelectorAll('[data-scan-factor][data-scan-choices="4"]')){
        const u=Number(factor.dataset.scanFactor);
        for(const fraction of [.2,.4,.6,.8]){
          pointer(page(),'pointerenter');pointer(factor,'pointerenter',null,fraction);
          const selected=Number(factor.dataset.scanValue),seen=new Set();
          for(let step=0;step<80;step++){
            sec3StateCheck.advance(50);
            const snapshot=read();seen.add(snapshot.index);
            assert(snapshot.state==='interaction'&&snapshot.section===name,'Factor scan changed tabs');
            assert(snapshot.parts[u]===selected,'Factor scan visited a different factor value');
          }
          assert(seen.size===64,'Factor scan must cover every matching address and wrap');
          pointer(factor,'pointerleave',page());
          staticCheck('radix factor exit');
        }
      }
      const output=scene.querySelector('[data-interaction-region]:not([data-scan-factor])');
      pointer(output,'pointerenter');
      const fixedIndex=read().index;sec3StateCheck.advance(100);
      assert(read().index===fixedIndex,'Output hover should still select a fixed address');
      pointer(output,'pointerleave',page());pointer(page(),'pointerleave');
      assert(read().section===name&&read().index===fixedIndex,'Factor/output interaction exit should continue from the selected address');
      results.push(name+': all four factors scan only their selected value, wrap, and stop on exit');
    }
    document.getElementById('regroup-tab').click();
    for(const strip of document.querySelectorAll('[data-regroup-distribution]')){
      const stride=4**Number(strip.dataset.scanFactor),bars=strip.querySelectorAll('[data-probability]');
      for(let value=0;value<64;value++){
        const bounds=strip.getBoundingClientRect(),bar=bars[value].getBoundingClientRect();
        const fraction=(bar.x+bar.width/2-bounds.x)/bounds.width;
        pointer(page(),'pointerenter');pointer(strip,'pointerenter',null,fraction);
        assert(Number(strip.dataset.scanValue)===value,'Merged factor hover selected the wrong address');
        const seen=new Set();
        for(let step=0;step<8;step++){
          sec3StateCheck.advance(50);
          const snapshot=read();seen.add(snapshot.index);
          assert(snapshot.state==='interaction'&&Math.floor(snapshot.index/stride)%64===value,
            'Merged-factor scan visited a different grouped address');
          pointer(strip,'pointermove',null,fraction);
          assert(read().progress===snapshot.progress,'Pointer movement reset the grouped scan');
        }
        assert(seen.size===4,'Merged-factor scan must cover all four matching slots and wrap');
        pointer(strip,'pointerleave',page());staticCheck('merged factor exit');
        const position=read().progress;
        pointer(page(),'pointerleave');
        assert(read().section==='regroup'&&read().progress===position,'Merged-factor exit did not continue from the current address');
      }
    }
    results.push('Both merged factors scan their four matching slots for every grouped address');
    const checkRegroupTopK=k=>{
      const probabilities=read().slotProbabilities;
      const expected=probabilities.map((_,i)=>i).sort((a,b)=>probabilities[b]-probabilities[a]||a-b).slice(0,k).sort((a,b)=>a-b);
      for(const matrix of document.querySelectorAll('[data-regroup-matrix]')){
        const selected=[...matrix.querySelectorAll('[data-top-k="true"]')];
        assert(selected.length===k,'Regroup has the wrong number of Top-K slots');
        assert(selected.map(node=>Number(node.dataset.slot)).sort((a,b)=>a-b).join(',')===expected.join(','),
          'Regroup layouts disagree with probability ranking');
        assert(selected.every(node=>node.getAttribute('stroke')==='#202020'&&Number(node.getAttribute('stroke-opacity'))>.9),
          'Regroup Top-K must use black outlines');
        const min=Math.min(...probabilities),max=Math.max(...probabilities);
        for(const node of matrix.querySelectorAll('[data-slot]')){
          probabilityColorCheck(node,max===min?.5:(probabilities[Number(node.dataset.slot)]-min)/(max-min));
        }
      }
    };
    for(const k of [1,8,16]){
      topK.value=k;topK.dispatchEvent(new Event('input',{bubbles:true}));checkRegroupTopK(k);
    }
    document.querySelector('.factor-value').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));
    checkRegroupTopK(16);
    for(const factor of document.querySelectorAll('.factor-editor')){
      factor.querySelector('.factor-value').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    }
    checkRegroupTopK(16);
    results.push('Regroup Top-K updates both layouts for K changes, distribution edits, and probability ties');
    const names=['distribution','tree','heatmap','regroup','waveform'];
    for(const name of names){
      for(const seconds of [0,.5,1,1.5]){
        document.getElementById(names[(names.indexOf(name)+1)%names.length]+'-tab').click();
        document.getElementById(name+'-tab').click();
        const region=document.getElementById(name==='distribution'?'scene':name+'-scene').querySelector('[data-interaction-region]');
        pointer(page(),'pointerenter');pointer(region,'pointerenter');
        sec3StateCheck.remaining(seconds);
        const position=read().progress;
        pointer(region,'pointerleave',page());pointer(page(),'pointerleave');
        assert(read().progress===position&&read().repeat===(seconds<1),name+': incorrect one-second repeat threshold');
        if(seconds<1){
          pointer(page(),'pointerenter');pointer(page(),'pointerleave');
          assert(read().repeat,name+': hover-only pause discarded the extra cycle');
          sec3StateCheck.end();
          assert(read().section===name&&read().progress===0&&!read().repeat,name+': extra cycle did not play exactly once');
        }
        sec3StateCheck.end();
        assert(read().section===names[(names.indexOf(name)+1)%names.length],name+': playback failed to advance after completing its cycles');
      }
    }
    document.getElementById('heatmap-tab').click();
    const jointFactor=document.querySelector('#heatmap-scene [data-interaction-region]');
    pointer(page(),'pointerenter');pointer(jointFactor,'pointerenter',null,.6);
    const selected=sec3StateCheck.read().progress;
    assert(selected===2/16,'Joint hover should set the scan position to the selected factor slice');
    pointer(jointFactor,'pointerleave',page());pointer(page(),'pointerleave');
    assert(read().progress===selected,'Joint did not resume at the selected slice');
    results.push('All tabs: under one second adds exactly one cycle; other cases continue normally');
    pointer(page(),'pointerenter');
    const slots=[...document.querySelectorAll('#heatmap-scene circle[data-slot]')];
    assert(slots.length===256,'Joint slot hit regions are incomplete');
    const front=slots.at(-1),bounds=front.getBoundingClientRect();
    assert(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)===front,
      'Visible slot cannot receive native pointer hits');
    for(const slot of slots){
      pointer(slot,'pointerenter');
      const snapshot=read(),address=Number(slot.dataset.slot);
      assert(snapshot.state==='interaction','Slot hover did not enter interaction');
      assert(snapshot.factorLevels.filter(value=>Number(value)>.7).length===4,'Slot must activate exactly four factor values');
      for(let u=0;u<4;u++){
        const levels=snapshot.factorLevels.slice(u*4,u*4+4).map(Number);
        assert(levels.indexOf(Math.max(...levels))===Math.floor(address/4**u)%4,'Slot highlighted the wrong factor value');
      }
      assert(Number(slot.getAttribute('stroke-width'))>1,'Hovered slot is missing its outline');
      sec3StateCheck.advance(50);
      assert(read().rotation>snapshot.rotation,'Slot hover stopped rotation');
      assert(read().factorLevels.join(',')===snapshot.factorLevels.join(','),'Rotation changed the selected slot address');
      pointer(slot,'pointerleave',page());staticCheck('slot exit');
    }
    pointer(page(),'pointerleave');
    results.push('All 256 joint slots activate their four factors, keep rotating, and clear on exit');
    sec3StateCheck.uniform();
    for(const name of ['heatmap','regroup']){
      document.getElementById(name+'-tab').click();
      pointer(page(),'pointerenter');
      const nodes=[...document.querySelectorAll(name==='heatmap'?'#heatmap-scene circle[data-slot]':'#regroup-scene rect[data-slot]')];
      nodes.forEach(node=>probabilityColorCheck(node,.5));
      pointer(page(),'pointerleave');
    }
    results.push('Uniform probabilities use a consistent midpoint color in both views');
    for(let i=0;i<sec3Transitions.length;i++){
      const current=sec3Transitions[i],previous=sec3Transitions[i-1];
      assert(!previous||previous.state===current.state||previous.state==='rest'||current.state==='rest',
        'State transition bypassed rest');
      assert(current.state==='interaction'||!current.region&&!current.hover,'Interaction state leaked through rest');
    }
    results.push('Every active-mode transition passes through rest and clears interaction state');
    assert(stateErrors.length===0,'Browser errors: '+stateErrors.join('; '));
    const node=document.createElement('pre');node.id='state-result';node.textContent=JSON.stringify({results,errors:stateErrors});document.body.append(node);
  } catch(error) {
    const node=document.createElement('pre');node.id='state-result';node.textContent=JSON.stringify({results,errors:[String(error),...stateErrors]});document.body.append(node);
  }
},250));
</script>
"""


def main():
    source = ROOT / "animations/product_softmax.js"
    markup = ROOT / "animations/product_softmax.html"
    with tempfile.TemporaryDirectory(prefix="sec3-state-") as profile:
        script_file = tempfile.NamedTemporaryFile(
            prefix="_state_", suffix=".js", dir=source.parent, delete=False)
        script_file.close()
        script = Path(script_file.name)
        page = script.with_suffix(".html")
        try:
            code = source.read_text(encoding="utf-8")
            # Virtual time does not reliably advance native animation frames.
            # Drive the queued callback explicitly while retaining the real frame logic.
            clock = "const {document, requestAnimationFrame, cancelAnimationFrame} = scope;"
            assert clock in code
            code = code.replace(clock,
                "const {document,cancelAnimationFrame}=scope;"
                "const requestAnimationFrame=callback=>{window.sec3CheckFrame=callback;return 0;};", 1)
            code = code.replace("function updatePlayback(){",
                "function updatePlayback(){window.sec3Transitions.push({state:viewState,"
                "region:interactionRegion!==null,hover:heatmapHover!==null});", 1)
            # Skip the cosmetic page flip so virtual time can inspect the new page.
            code = code.replace(
                "if(turnedPages.length&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)",
                "if(false)", 1)
            anchor = "const cardScroll=document.querySelector('.card-scroll');"
            assert anchor in code
            script.write_text(code.replace(anchor, INSPECTOR + anchor, 1), encoding="utf-8")
            document = re.sub(
                r'product_softmax\.js\?v=[^"]+', script.name,
                markup.read_text(encoding="utf-8"), count=1)
            page.write_text(document.replace("</head>", CHECKS + "</head>", 1), encoding="utf-8")
            result = subprocess.run(
                [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
                 "--window-size=1366,1000", "--virtual-time-budget=30000",
                 f"--user-data-dir={profile}", "--dump-dom", page.as_uri()],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=50)
            match = re.search(r'<pre id="state-result">(.*?)</pre>', result.stdout, re.S)
            if not match:
                raise RuntimeError("Chrome returned no result: " + result.stderr[-600:])
            output = json.loads(html.unescape(match.group(1)))
            if output["errors"]:
                raise RuntimeError(output)
            for result in output["results"]:
                print("OK", result)
        finally:
            page.unlink(missing_ok=True)
            script.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
