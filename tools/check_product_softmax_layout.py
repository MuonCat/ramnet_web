"""Check sec3 page-turn bounds and scrollbars in local Chrome."""

import html
import json
import re
import subprocess
import tempfile

from check_site import CHROME, ROOT


CHECK = """<script>
window.layoutErrors=[];window.layoutStartupWarnings=[];window.layoutChecking=false;
addEventListener('error',event=>{
  if(!layoutChecking&&event.message==='ResizeObserver loop completed with undelivered notifications.')
    layoutStartupWarnings.push(event.message);
  else layoutErrors.push(event.message);
});
addEventListener('unhandledrejection',event=>layoutErrors.push(String(event.reason)));
addEventListener('load',()=>setTimeout(async()=>{
  const result={errors:layoutErrors,startupWarnings:layoutStartupWarnings,samples:0};
  try {
    const host=document.querySelector('[data-exhibit="product_softmax"]');
    const root=host.shadowRoot,clip=root.querySelector('.card-scroll');
    const shell=root.querySelector('.animation-shell');
    const tabs=[...root.querySelectorAll('.section-tab')];
    const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
    const check=(condition,message)=>{if(!condition)throw Error(message)};
    await pause();
    window.layoutChecking=true;
    result.viewport=[innerWidth,innerHeight];
    result.clip=[getComputedStyle(clip).overflowX,getComputedStyle(clip).overflowY];
    result.outerOverflow=getComputedStyle(host.parentElement).overflowY;
    result.bleed=parseFloat(clip.style.getPropertyValue('--page-flip-bleed'));
    check(result.clip.every(value=>value==='hidden'),'Unexpected scroll container');
    check(result.outerOverflow==='visible','Outer figure still clips vertically');
    const hint=root.querySelector('.control-hint'),slider=root.getElementById('topK');
    const compact=!!root.querySelector('.compact-interactions');
    hint.hidden=false;
    const hintBounds=hint.getBoundingClientRect(),sliderBounds=slider.getBoundingClientRect();
    if(compact){
      const panel=root.querySelector('.interaction-panel').getBoundingClientRect();
      check(hintBounds.bottom<=sliderBounds.top+1&&hintBounds.top>=panel.top-1,
        'Compact Top-K hint overlaps the slider or leaves the control panel');
    }else check(hintBounds.top>=sliderBounds.bottom-1,'Desktop Top-K hint is not below the slider');
    hint.hidden=true;
    const baseline=shell.getBoundingClientRect();
    if(root.querySelector('.section-pages').getAttribute('aria-orientation')==='vertical'){
      const fontSize=parseFloat(getComputedStyle(tabs[0]).fontSize);
      const tabHeight=parseFloat(shell.style.getPropertyValue('--page-tab-height'));
      const safeInset=20*.68+fontSize,sceneHeight=shell.clientHeight-16;
      const tops=tabs.map(tab=>parseFloat(tab.style.top));
      const gap=tops[1]-tops[0]-tabHeight;
      const expected=Math.max(0,Math.min(fontSize*2.4,
        (sceneHeight-2*safeInset-tabs.length*tabHeight)/(tabs.length-1)));
      check(Math.abs(gap-expected)<1,'Tab gap does not follow the font size and corner clearance');
      check(tops[0]>=safeInset-1&&tops.at(-1)+tabHeight<=sceneHeight-safeInset+1,
        'Tabs enter the page corners');
      result.tabGap=gap;
    }
    const sample=animations=>{
      const bounds=clip.getBoundingClientRect();
      for(const animation of animations){
        const page=animation.effect.target.getBoundingClientRect();
        check(page.top>=bounds.top-1&&page.bottom<=bounds.bottom+1,
          `Page clipped: ${JSON.stringify({pageTop:page.top,pageBottom:page.bottom,clipTop:bounds.top,clipBottom:bounds.bottom})}`);
      }
      check(clip.offsetHeight-clip.clientHeight===0,'Horizontal scrollbar occupies height');
      check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+2,'Page overflows horizontally');
      const current=shell.getBoundingClientRect();
      check(Math.abs(current.width-baseline.width)<1&&Math.abs(current.height-baseline.height)<1,'Page turn changed layout size');
      result.samples++;
    };
    for(const tab of [...tabs.slice(1),tabs[0]]){
      tab.click();
      await pause();
      if(tab.id==='regroup-tab'){
        const scene=root.getElementById('regroup-scene');
        const labels=[...scene.querySelectorAll('text')];
        const viewA=labels.find(node=>node.textContent==='View A');
        const viewB=labels.find(node=>node.textContent==='View B');
        const tall=scene.querySelector('[data-regroup-matrix="64x4"]').getBoundingClientRect();
        const wide=scene.querySelector('[data-regroup-matrix="4x64"]').getBoundingClientRect();
        const a=viewA.getBoundingClientRect(),b=viewB.getBoundingClientRect();
        const frame=scene.getBoundingClientRect();
        check(a.right<tall.left&&a.top>=tall.top&&a.bottom<=tall.bottom,
          'View A overlaps the tall array or escapes its side');
        check(b.top>wide.bottom&&b.bottom<=frame.bottom,
          'View B overlaps the wide array or is clipped');
        check(parseFloat(getComputedStyle(viewA).fontSize)>=16&&
          parseFloat(getComputedStyle(viewB).fontSize)>=16,
          'Regroup view captions are too small');
      }
      const outgoing=root.getAnimations().filter(animation=>animation.effect.target.classList.contains('page-layer'));
      check(outgoing.length>0,'Missing outgoing animation');
      outgoing.forEach(animation=>animation.pause());
      let flatHeight=0;
      for(const fraction of [0,.1,.25,.45,.6,.8,.95,.999]){
        outgoing.forEach(animation=>{animation.currentTime=650*fraction});
        sample(outgoing);
        const projectedHeight=outgoing[0].effect.target.getBoundingClientRect().height;
        if(fraction===0)flatHeight=projectedHeight;
        if(fraction===.45)check(projectedHeight>flatHeight+1,'Perspective expansion did not render');
      }
      outgoing.forEach(animation=>animation.finish());
      await pause();
      const incoming=root.getAnimations().filter(animation=>animation.effect.target.classList.contains('page-layer'));
      check(incoming.length>0,'Missing incoming animation');
      incoming.forEach(animation=>animation.pause());
      for(const fraction of [0,.25,.55,.8,.999]){
        incoming.forEach(animation=>{animation.currentTime=500*fraction});
        sample(incoming);
      }
      incoming.forEach(animation=>animation.finish());
      await pause();
    }
  } catch(error) {result.errors.push(error.message)}
  const output=document.createElement('pre');output.id='layout-result';
  output.textContent=JSON.stringify(result);document.body.append(output);
},800));
</script>"""


def main():
    preview = ROOT / "_sec3_layout_check.html"
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    preview.write_text(source.replace("</head>", CHECK + "</head>"), encoding="utf-8")
    try:
        for width, height in [(1512, 982), (1280, 800), (1920, 1080), (390, 844)]:
            with tempfile.TemporaryDirectory(prefix="ramnet-layout-") as profile:
                command = [str(CHROME), "--headless=new", "--no-sandbox",
                           f"--window-size={width},{height}", "--virtual-time-budget=8500",
                           f"--user-data-dir={profile}", "--dump-dom", preview.as_uri()]
                process = subprocess.run(command, capture_output=True, text=True,
                                         encoding="utf-8", errors="replace", timeout=60)
                match = re.search(r'<pre id="layout-result">(.*?)</pre>', process.stdout, re.S)
                if not match:
                    raise RuntimeError(f"No browser result: {process.stderr[-500:]}")
                result = json.loads(html.unescape(match.group(1)))
                print(json.dumps(result, ensure_ascii=False), flush=True)
                if result["errors"]:
                    raise RuntimeError(f"Layout check failed at {width}x{height}")
    finally:
        preview.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
