// Each surface owns one pointer, allowing movement and looking at the same time.
export function bindWalkInput({canvas, joystick, knob, enabled, look}) {
  let lookId=null, moveId=null, lastX=0, lastY=0;
  const movement={forward:0,side:0};
  const captures=new Map();
  function capture(element,id){element.setPointerCapture(id);captures.set(id,element);}
  function release(id){const element=captures.get(id);captures.delete(id);if(element?.hasPointerCapture(id))element.releasePointerCapture(id);}
  function stopLook(e){if(e.pointerId!==lookId)return;const id=lookId;lookId=null;release(id);}
  function stopMove(e){if(e.pointerId!==moveId)return;const id=moveId;moveId=null;movement.forward=movement.side=0;knob.style.transform='translate(0px, 0px)';release(id);}
  function reset(){if(lookId!==null)stopLook({pointerId:lookId});if(moveId!==null)stopMove({pointerId:moveId});}
  canvas.addEventListener('pointerdown',e=>{if(!enabled()||lookId!==null||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();lookId=e.pointerId;lastX=e.clientX;lastY=e.clientY;capture(canvas,lookId);});
  canvas.addEventListener('pointermove',e=>{if(e.pointerId!==lookId||!enabled())return;e.preventDefault();look(e.clientX-lastX,e.clientY-lastY);lastX=e.clientX;lastY=e.clientY;});
  function updateStick(e){const rect=joystick.getBoundingClientRect(),radius=rect.width*.32;
    const dx=(e.clientX-rect.left-rect.width/2)/radius,dy=(e.clientY-rect.top-rect.height/2)/radius;
    const distance=Math.hypot(dx,dy),length=Math.min(1,distance),strength=Math.max(0,(length-.12)/.88);
    movement.side=distance?dx/distance*strength:0;movement.forward=distance?-dy/distance*strength:0;
    knob.style.transform=`translate(${dx/Math.max(1,distance)*radius}px, ${dy/Math.max(1,distance)*radius}px)`;
  }
  joystick.addEventListener('pointerdown',e=>{if(!enabled()||moveId!==null)return;e.preventDefault();moveId=e.pointerId;capture(joystick,moveId);updateStick(e);});
  joystick.addEventListener('pointermove',e=>{if(e.pointerId!==moveId||!enabled())return;e.preventDefault();updateStick(e);});
  for(const type of ['pointerup','pointercancel','lostpointercapture']){canvas.addEventListener(type,stopLook);joystick.addEventListener(type,stopMove);}
  return {movement,reset};
}
