// One scheduled frame for changes; continuous frames only while movement succeeds.
export function createRenderLoop({step,onIdle=()=>{},maxFps=60,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}) {
 let pending=null,dirty=false,hidden=false,disposed=false,last=null,sleeping=true;
 const interval=1000/maxFps;
 function schedule(){if(pending===null&&!hidden&&!disposed)pending=requestFrame(tick);}
 function tick(now){
  pending=null;if(hidden||disposed)return;
  if(last!==null&&now-last<interval-.5){schedule();return;}
  const dt=sleeping?1/60:Math.min((now-last)/1000,.05);last=now;sleeping=false;
  const changed=dirty;dirty=false;
  const moving=step(now,dt,changed);
  if(moving||dirty)schedule();else{sleeping=true;onIdle();}
 }
 return {
  invalidate(){dirty=true;schedule();},
  setHidden(value){hidden=value;if(hidden){if(pending!==null)cancelFrame(pending);pending=null;last=null;sleeping=true;onIdle();}else if(dirty)schedule();},
  dispose(){disposed=true;if(pending!==null)cancelFrame(pending);pending=null;},
  state:()=>({scheduled:pending!==null,hidden,dirty})
 };
}
