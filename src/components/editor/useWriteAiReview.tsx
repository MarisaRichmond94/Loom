'use client'

import { useRef, useState } from 'react'
import { notify, setNotificationBusy } from '@/lib/notifications'

// "Review in WriteAI" — the chapter header's Review button. Saves the book's
// canon manuscript to disk (the same export WriteAI ingests from), then hands
// off to WriteAI's review page with the book, chapter, and reviewer persona
// pre-selected. `draft=1` tells WriteAI to read
// the chapter's text straight from the freshly exported file (no ingest, no
// LLM cost) so the writer can iterate review→revise→re-review and only
// reindex once the revision lands. Loom's side of the contract ends at
// "file on disk + URL" — it never calls WriteAI's API.

const REVIEW_FOCUS = 'Literary Agent'

export function useWriteAiReview(seriesId: string) {
  const busyRef = useRef(false)
  const [reviewing, setReviewing] = useState(false)

  async function reviewInWriteAi(book: { id: string; title: string } | undefined, chapterId: string) {
    if (!book || busyRef.current) return
    busyRef.current = true
    setReviewing(true)
    setNotificationBusy(true)
    // WriteAI opens in a NEW tab so Loom stays on the chapter — the iteration
    // loop is edit here, ⌥⇧E, then "Send Updated Draft" over there. The tab
    // must be opened synchronously inside the click gesture (popup blockers
    // kill a window.open issued after the export's await); it gets pointed
    // at WriteAI when the export lands, or closed if the export fails.
    const tab = window.open('', '_blank')
    if (tab) {
      // This splash is a SEPARATE document, so Loom's CSS variables cannot
      // reach it — the background was hardcoded and stayed on the old palette
      // under UNIFIED_CHROME (KAN-17). Resolve the token here and interpolate
      // it in. The fallback is a deliberately neutral dark rather than a copy
      // of a palette value — a stale token literal here would be exactly the
      // bug this fixes.
      const splashBg =
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-surface-raised')
          .trim() || '#111'
      tab.document.open()
      tab.document.write(`<!doctype html>
<html data-mode="dark">
<head><meta charset="utf-8"><title>Opening WriteAI…</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;background:${splashBg};font:13px/1.5 system-ui,sans-serif}
canvas{width:260px;aspect-ratio:420/380;display:block}
p{margin-top:-8px;color:#9ca3af;letter-spacing:.01em}
</style>
</head>
<body>
<canvas id="c" width="420" height="380"></canvas>
<p>Exporting manuscript for review…</p>
<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
const W=420,H=380,CX=W/2,CY=H/2,ORBIT_R=122,NODE_COUNT=8,HUB_R=28;
const dark=()=>document.documentElement.dataset.mode==='dark'||window.matchMedia('(prefers-color-scheme: dark)').matches;
const P={
  large:  ()=>dark()?{r:129,g:140,b:248}:{r: 99,g:102,b:241},
  medium: ()=>dark()?{r:167,g:139,b:250}:{r:139,g: 92,b:246},
  small:  ()=>dark()?{r:192,g:132,b:252}:{r:168,g: 85,b:247},
  edge:   ()=>dark()?{r: 55,g: 48,b:163}:{r:224,g:231,b:255},
  edgeActive:()=>dark()?{r:129,g:140,b:248}:{r: 99,g:102,b:241},
  hub1:   ()=>dark()?{r:129,g:140,b:248}:{r: 79,g: 70,b:229},
  hub2:   ()=>dark()?{r: 55,g: 48,b:163}:{r: 99,g:102,b:241},
  pulse:  ()=>dark()?{r:192,g:132,b:252}:{r:168,g: 85,b:247},
  particle:()=>dark()?{r:167,g:139,b:250}:{r: 99,g:102,b:241},
};
function rgb(c,a){a=a===undefined?1:a;return 'rgba('+c.r+','+c.g+','+c.b+','+a+')';}
function lerp(a,b,t){return a+(b-a)*t;}
const nodeColors=['large','medium','small','medium','small','medium','small','large'];
const nodes=Array.from({length:NODE_COUNT},(_,i)=>{
  const angle=(i/NODE_COUNT)*Math.PI*2-Math.PI/2;
  return{id:i,baseAngle:angle,baseR:ORBIT_R,
    r:i===0||i===7?16:i%3===0?14:12,colorKey:nodeColors[i],lit:false,litTime:0,
    freqA:0.47+Math.random()*0.4,freqB:0.31+Math.random()*0.3,freqC:0.61+Math.random()*0.5,
    phaseA:Math.random()*Math.PI*2,phaseB:Math.random()*Math.PI*2,phaseC:Math.random()*Math.PI*2,
    radialDrift:18+Math.random()*14,angularDrift:0.18+Math.random()*0.14,
    orbitDir:i%2===0?1:-1,orbitSpeed:0.004+Math.random()*0.003};
});
function nodePos(n,s){
  const oa=n.baseAngle+n.orbitDir*n.orbitSpeed*s;
  const ro=n.radialDrift*Math.sin(n.freqA*s+n.phaseA);
  const ao=n.angularDrift*Math.sin(n.freqB*s+n.phaseB);
  const r=n.baseR+ro,a=oa+ao;
  return{x:CX+Math.cos(a)*r+5*Math.sin(n.freqC*s+n.phaseC),
         y:CY+Math.sin(a)*r+5*Math.cos(n.freqC*s+n.phaseC+1.1)};
}
const edges=[];
for(let i=0;i<NODE_COUNT;i++)edges.push([i,(i+1)%NODE_COUNT]);
edges.push([0,4],[1,5],[2,6],[3,7]);
let pulses=[];
function spawnPulse(from,to){pulses.push({from,to,prog:0,speed:0.016+Math.random()*0.014});}
let t=0,frame=0,nextLight=0,lastLitFrame=0,done=false,activeEdge=0;
function tick(){
  t+=0.016;frame++;
  ctx.clearRect(0,0,W,H);
  const pos=nodes.map(n=>nodePos(n,t));
  const pc=P.particle();
  for(let i=0;i<24;i++){
    const a=(i/24)*Math.PI*2+t*0.28,r=ORBIT_R+50+Math.sin(t*0.65+i*0.85)*18;
    ctx.beginPath();ctx.arc(CX+Math.cos(a)*r,CY+Math.sin(a)*r,1.5,0,Math.PI*2);
    ctx.fillStyle=rgb(pc,0.08+0.04*Math.sin(t*1.1+i));ctx.fill();
  }
  edges.forEach(([ea,eb],ei)=>{
    const pa=pos[ea],pb=pos[eb];
    ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);
    if(ei<=activeEdge){ctx.strokeStyle=rgb(P.edgeActive(),0.28);ctx.lineWidth=1;ctx.setLineDash([]);}
    else{ctx.strokeStyle=rgb(P.edge(),dark()?0.22:0.55);ctx.lineWidth=0.5;ctx.setLineDash([3,5]);}
    ctx.stroke();ctx.setLineDash([]);
  });
  nodes.forEach((n,i)=>{
    if(!n.lit)return;
    ctx.beginPath();ctx.moveTo(CX,CY);ctx.lineTo(pos[i].x,pos[i].y);
    ctx.strokeStyle=rgb(P.edgeActive(),0.18);ctx.lineWidth=0.8;ctx.stroke();
  });
  const pulse=0.5+0.5*Math.sin(t*2.0),h1=P.hub1(),h2=P.hub2();
  ctx.beginPath();ctx.arc(CX,CY,HUB_R+10+pulse*7,0,Math.PI*2);
  ctx.fillStyle=rgb(h1,(dark()?0.18:0.10)*(0.6+0.4*pulse));ctx.fill();
  ctx.beginPath();ctx.arc(CX,CY,HUB_R,0,Math.PI*2);
  const g=ctx.createRadialGradient(CX,CY-6,2,CX,CY,HUB_R);
  g.addColorStop(0,rgb(h1,0.92));g.addColorStop(1,rgb(h2,0.96));
  ctx.fillStyle=g;ctx.fill();
  ctx.strokeStyle=rgb(P.medium(),0.55);ctx.lineWidth=1.5;ctx.stroke();
  ctx.beginPath();ctx.arc(CX,CY,HUB_R+7,t*0.8,t*0.8+Math.PI*1.3);
  ctx.strokeStyle=rgb(P.small(),0.4);ctx.lineWidth=1.5;ctx.stroke();
  ctx.beginPath();ctx.arc(CX,CY,HUB_R+7,t*0.8+Math.PI,t*0.8+Math.PI*1.7);
  ctx.strokeStyle=rgb(P.medium(),0.25);ctx.lineWidth=1;ctx.stroke();
  const pu=P.pulse();
  pulses.forEach(p=>{
    const pa=pos[p.from],pb=pos[p.to];
    const px=lerp(pa.x,pb.x,p.prog),py=lerp(pa.y,pb.y,p.prog);
    ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fillStyle=rgb(pu,0.85);ctx.fill();
    ctx.beginPath();ctx.arc(px,py,8,0,Math.PI*2);ctx.fillStyle=rgb(pu,0.18);ctx.fill();
  });
  nodes.forEach((n,i)=>{
    const{x,y}=pos[i],col=P[n.colorKey]();
    const bright={r:Math.min(255,col.r+50),g:Math.min(255,col.g+50),b:Math.min(255,col.b+50)};
    const lit=n.lit?1:0,age=n.lit?Math.min((t-n.litTime)*1.8,1):0;
    if(n.lit){ctx.beginPath();ctx.arc(x,y,n.r+11,0,Math.PI*2);ctx.fillStyle=rgb(col,0.12*age);ctx.fill();}
    ctx.beginPath();ctx.arc(x,y,n.r+3,0,Math.PI*2);ctx.fillStyle=rgb(col,(dark()?0.15:0.12)+0.1*lit);ctx.fill();
    ctx.beginPath();ctx.arc(x,y,n.r,0,Math.PI*2);
    const ng=ctx.createRadialGradient(x,y-3,1,x,y,n.r);
    ng.addColorStop(0,rgb(bright,0.5+0.35*lit));ng.addColorStop(1,rgb(col,0.7+0.25*lit));
    ctx.fillStyle=ng;ctx.fill();
    ctx.strokeStyle=rgb(bright,0.35+0.4*lit);ctx.lineWidth=1;ctx.stroke();
  });
  pulses.forEach(p=>p.prog+=p.speed);
  pulses=pulses.filter(p=>p.prog<1.05);
  if(!done&&frame-lastLitFrame>38){
    lastLitFrame=frame;
    if(nextLight<NODE_COUNT){
      nodes[nextLight].lit=true;nodes[nextLight].litTime=t;
      spawnPulse(nextLight,(nextLight+2)%NODE_COUNT);
      if(nextLight>0)spawnPulse(nextLight-1,nextLight);
      activeEdge=nextLight++;
      if(nextLight===NODE_COUNT){
        done=true;
        setTimeout(()=>{done=false;nextLight=0;frame=0;lastLitFrame=0;
          nodes.forEach(n=>{n.lit=false;n.litTime=0;});pulses=[];activeEdge=0;},2400);
      }
    }
  }
  if(frame%20===0&&!done){
    const idx=Math.floor(Math.random()*NODE_COUNT);
    spawnPulse(idx,(idx+1+Math.floor(Math.random()*(NODE_COUNT-2)))%NODE_COUNT);
  }
  requestAnimationFrame(tick);
}
tick();
</script>
</body>
</html>`)
      tab.document.close()
    }
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${book.id}/export/canon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId }),
      })
      const data = await res.json() as { ok?: boolean; reviewChapter?: number | null; error?: string }
      if (!res.ok || !data.ok) {
        notify('error', data.error ?? 'Canon save failed — review not started.')
        tab?.close()
        return
      }
      const params = new URLSearchParams({
        pane: 'review',
        book: book.title,
        focus: REVIEW_FOCUS,
        draft: '1',
      })
      // Unnumbered non-prologue chapters (and chapters the canon walk skips)
      // have no address in WriteAI; omitting the param lands on the book with
      // the chapter dropdown left for the writer.
      if (typeof data.reviewChapter === 'number') {
        params.set('chapter', String(data.reviewChapter))
      }
      const base = process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:5173'
      const url = `${base}/?${params.toString()}`
      if (tab) tab.location.href = url
      else window.location.href = url // popup blocked — same-tab fallback
    } catch {
      notify('error', 'Canon save failed — review not started.')
      tab?.close()
    } finally {
      busyRef.current = false
      setReviewing(false)
      setNotificationBusy(false)
    }
  }

  return { reviewInWriteAi, reviewing }
}
