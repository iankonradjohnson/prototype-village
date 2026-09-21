import * as THREE from 'three';
import { PointerLockControls } from './vendor/PointerLockControls.js';
import { bindWalkInput } from './touch-controls.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const mobileMode=params.get('mobile')==='1'||(params.get('mobile')!=='0'&&(matchMedia('(pointer: coarse)').matches||(navigator.maxTouchPoints>0&&innerWidth<=1100)));
const dataRoot=mobileMode?'./data/mobile/':'./data/';
document.body.classList.toggle('mobile',mobileMode);
if(mobileMode){$('desktopHelp').hidden=true;$('touchHelp').hidden=false;document.querySelector('.footnote').textContent='Touch controls · landscape recommended · Wi-Fi for first load';}

const renderer=new THREE.WebGLRenderer({antialias:!mobileMode,powerPreference:'high-performance'});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,mobileMode?1:1.35));
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
renderer.shadowMap.enabled=!mobileMode;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('world').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#b7cbd0');scene.fog=new THREE.Fog('#b7cbd0',mobileMode?50:125,mobileMode?120:245);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,mobileMode?145:300);
const controls=new PointerLockControls(camera,renderer.domElement);controls.pointerSpeed=.72;
const hemi=new THREE.HemisphereLight('#e4efff','#767251',2);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff0ca',3.1);sun.position.set(-40,85,5);sun.target.position.set(-15,0,-15);scene.add(sun,sun.target);
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-85;sun.shadow.camera.right=85;sun.shadow.camera.top=95;sun.shadow.camera.bottom=-95;sun.shadow.camera.near=1;sun.shadow.camera.far=220;sun.shadow.bias=-.0002;sun.shadow.normalBias=.04;
const worldRotation=new THREE.Matrix4().makeRotationX(-Math.PI/2), rows=[], keys=new Set();
let data,nav,ready=false,started=false,overview=false,last=performance.now(),sampleAt=last,frames=0,fps=0,lodAt=0,quality='balanced',drawnLODs=[0,0,0], culled=0,textureFails=[];
let nearSources={},nearActive=0;const nearPending=new Set(),nearQueue=[],nearReady=new Set(),nearFailures=new Map(),mobileNearCache=new Map();let mobileWanted=new Set();
const viewFrustum=new THREE.Frustum(),viewProjection=new THREE.Matrix4();
function makeGeometry(l,buffer){
 const b=new THREE.BufferGeometry();
 if(l.format==='compact-mobile'){
  b.setAttribute('position',new THREE.BufferAttribute(new Float32Array(buffer,l.offset,l.vertices*3),3));
  b.setAttribute('normal',new THREE.BufferAttribute(new Int8Array(buffer,l.normalOffset,l.vertices*3),3,true));
  b.setAttribute('uv',l.uvBytes===4?new THREE.BufferAttribute(new Float32Array(buffer,l.uvOffset,l.vertices*2),2):new THREE.Float16BufferAttribute(new Uint16Array(buffer,l.uvOffset,l.vertices*2),2));
  const IndexArray=l.indexBytes===2?Uint16Array:Uint32Array;b.setIndex(new THREE.BufferAttribute(new IndexArray(buffer,l.indexOffset,l.indices),1));
 }else{
  const ib=new THREE.InterleavedBuffer(new Float32Array(buffer,l.offset,l.vertices*8),8);b.setAttribute('position',new THREE.InterleavedBufferAttribute(ib,3,0));b.setAttribute('normal',new THREE.InterleavedBufferAttribute(ib,3,3));b.setAttribute('uv',new THREE.InterleavedBufferAttribute(ib,2,6));b.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,l.indexOffset,l.indices),1));
 }
 for(const [start,count,mat]of l.groups)b.addGroup(start,count,mat);b.computeBoundingSphere();return b;
}
function requestNear(r){if(nearPending.has(r.meshId)||nearReady.has(r.meshId)||!nearSources[r.meshId]||(nearFailures.get(r.meshId)||0)>performance.now())return;nearPending.add(r.meshId);nearQueue.push(r);pumpNear();}
function trimMobileNear(){if(!mobileMode)return;for(const [id,geometry] of mobileNearCache){if(mobileNearCache.size<=64)break;if(mobileWanted.has(id))continue;for(const row of rows)if(row.meshId===id){if(row.mesh.geometry===geometry)row.mesh.geometry=row.fallback;row.geometries[0]=row.fallback;}geometry.dispose();mobileNearCache.delete(id);nearReady.delete(id);}}
function pumpNear(){while(nearActive<(mobileMode?2:3)&&nearQueue.length){const r=nearQueue.shift(),spec=nearSources[r.meshId];if(mobileMode&&!mobileWanted.has(r.meshId)){nearPending.delete(r.meshId);continue;}nearActive++;unpack(dataRoot+spec.file+(data.runtimeVersion?'?v='+data.runtimeVersion:'')).then(buffer=>{const geometry=makeGeometry(spec.level,buffer);r.geometries[0]=geometry;if(mobileMode)mobileNearCache.set(r.meshId,geometry);nearReady.add(r.meshId);updateLODs();trimMobileNear();sun.shadow.needsUpdate=true;}).catch(error=>{nearFailures.set(r.meshId,performance.now()+30000);console.warn('Near detail unavailable',error.message);}).finally(()=>{nearPending.delete(r.meshId);nearActive--;pumpNear();});}}
const vec=new THREE.Vector3(),v2=new THREE.Vector3(),euler=new THREE.Euler(0,0,0,'YXZ');
function notify(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notice').hidden=true,6500);}
function progress(message,pct){$('loadStatus').textContent=message;$('progressFill').style.width=pct+'%';}
async function unpack(url,onProgress){
 const urls=Array.isArray(url)?url:[url];let index=0,reader=null,loaded=0;
 const stream=new ReadableStream({async pull(controller){try{while(true){if(!reader){if(index===urls.length){controller.close();return;}const target=urls[index++],response=await fetch(target);if(!response.ok)throw new Error(`Could not load ${target}: ${response.status}`);reader=response.body.getReader();}const {done,value}=await reader.read();if(done){reader=null;continue;}loaded+=value.byteLength;onProgress?.(loaded);controller.enqueue(value);return;}}catch(error){controller.error(error);}},cancel(reason){return reader?.cancel(reason);}});
 return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function point(v){return new THREE.Vector3(v[0],v[2],-v[1]);}
function blockedAt(x,z){const n=data.navigation;const ix=Math.floor((x-n.origin[0])/n.step),iy=Math.floor((-z-n.origin[1])/n.step);if(ix<1||iy<1||ix>=n.width-1||iy>=n.height-1)return true;return nav[iy*n.width+ix]!==0;}
function canStand(x,z){const b=data.navigation.bounds||[-71,-39,55,79];if(x<b[0]||x>b[2]||-z<b[1]||-z>b[3])return false;for(const [dx,dz]of [[0,0],[.19,0],[-.19,0],[0,.19],[0,-.19]])if(blockedAt(x+dx,z+dz))return false;return true;}
function nearestClear(p){if(canStand(p.x,p.z))return p;for(let r=.25;r<4;r+=.25)for(let a=0;a<Math.PI*2;a+=Math.PI/8){let x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;if(canStand(x,z))return new THREE.Vector3(x,p.y,z);}return p;}
function visit(index){if(!ready)return;input.reset();keys.clear();const view=data.cameras[index];overview=view.overview;let pos=point(view.position);if(!overview){pos.y=1.72;}camera.position.copy(pos);camera.lookAt(point(view.target));camera.updateMatrixWorld();$('location').textContent=view.name.replace(/^\d+ /,'');$('places').value=index;$('walk').textContent=overview?'Return to street ↗':'Walk here ↗';updateLODs();sun.shadow.needsUpdate=true;}
function beginWalk(){if(overview)visit(0);if(!mobileMode)controls.lock();}
controls.addEventListener('lock',()=>{$('crosshair').hidden=false;$('instructions').hidden=true;keys.clear();});
controls.addEventListener('unlock',()=>{$('crosshair').hidden=true;keys.clear();});
document.addEventListener('pointerlockerror',()=>notify('Mouse capture is unavailable here. Drag the view to look around; WASD still walks.'));
const input=bindWalkInput({canvas:renderer.domElement,joystick:$('joystick'),knob:$('joystickKnob'),enabled:()=>started&&$('instructions').hidden&&!controls.isLocked,look:(dx,dy)=>{euler.setFromQuaternion(camera.quaternion);euler.y-=dx*.003;euler.x=THREE.MathUtils.clamp(euler.x-dy*.003,-1.5,1.5);camera.quaternion.setFromEuler(euler);}});
function clearInput(){keys.clear();input.reset();}
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
window.addEventListener('keydown',e=>{if(['SELECT','INPUT'].includes(document.activeElement.tagName))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){const first=!keys.has(e.code);keys.add(e.code);if(first)move(.03);e.preventDefault();}if(e.code==='KeyR'&&ready)visit(0);});
window.addEventListener('keyup',e=>keys.delete(e.code));
function updateLODs(){const mobileCandidates=[];camera.updateMatrixWorld();viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);viewFrustum.setFromProjectionMatrix(viewProjection);drawnLODs=[0,0,0];culled=0;let factor=(quality==='high'?1.65:quality==='light'?.62:1)*(mobileMode?.65:1);
 for(const r of rows){const dist=Math.max(0,camera.position.distanceTo(r.center)-r.radius*.45);let near=r.plant?(r.radius>3?23:9):29,mid=r.plant?(r.radius>3?58:23):72,far=r.groundcover?36:r.plant&&r.radius<3?75:260;if(r.groundcover){near=6;mid=16;}
  const level=dist<near*factor?0:dist<mid*factor?1:2,visible=(dist<far*factor||!r.plant)&&(!mobileMode||dist<(r.groundcover?20:r.plant&&r.radius<3?40:115));
  r.mesh.visible=visible;if(!visible){culled++;continue;}drawnLODs[level]++;if(r.level!==level||r.mesh.geometry!==r.geometries[level]){r.mesh.geometry=r.geometries[level];r.level=level;}if(level===0&&r.plant&&viewFrustum.intersectsObject(r.mesh)){if(mobileMode&&!r.groundcover)mobileCandidates.push({r,dist});else if(!mobileMode)requestNear(r);}
 }
 if(mobileMode){mobileCandidates.sort((a,b)=>a.dist-b.dist);const chosen=[];mobileWanted=new Set();for(const item of mobileCandidates){if(mobileWanted.has(item.r.meshId))continue;mobileWanted.add(item.r.meshId);chosen.push(item.r);if(chosen.length===40)break;}for(const r of chosen){if(mobileNearCache.has(r.meshId)){const g=mobileNearCache.get(r.meshId);mobileNearCache.delete(r.meshId);mobileNearCache.set(r.meshId,g);}requestNear(r);}trimMobileNear();}
}
function move(dt){if(!started||!$('instructions').hidden)return;const forward=input.movement.forward+(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),side=input.movement.side+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);if(!forward&&!side)return;
 camera.getWorldDirection(vec);vec.y=0;vec.normalize();v2.crossVectors(vec,camera.up).normalize();const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?4.5:2.3)*(overview?7:1)*dt/Math.max(1,Math.hypot(forward,side));const dx=(vec.x*forward+v2.x*side)*speed,dz=(vec.z*forward+v2.z*side)*speed;
 if(overview){camera.position.x+=dx;camera.position.z+=dz;return;}
 // Axis separation permits sliding along walls, with substeps preventing tunnelling.
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.09));for(let i=0;i<steps;i++){if(canStand(camera.position.x+dx/steps,camera.position.z))camera.position.x+=dx/steps;if(canStand(camera.position.x,camera.position.z+dz/steps))camera.position.z+=dz/steps;}
}
function animate(now){if(window.reviewComplete)return;requestAnimationFrame(animate);if(mobileMode&&now-last<1000/30)return;const dt=Math.min((now-last)/1000,.05);last=now;move(dt);if(ready&&now-lodAt>150){updateLODs();lodAt=now;}renderer.render(scene,camera);frames++;if(now-sampleAt>1000){fps=Math.round(frames*1000/(now-sampleAt));frames=0;sampleAt=now;$('stats').textContent=`${fps} fps · ${(renderer.info.render.triangles/1000).toFixed(0)}k triangles`;$('performance').textContent=`Measured in this browser\n${fps} frames / second\n${renderer.info.render.triangles.toLocaleString()} triangles drawn\n${renderer.info.render.calls} draw calls\nLOD near / mid / far: ${drawnLODs.join(' / ')}\n${culled} small distant plants hidden\n${quality} detail · ${renderer.getPixelRatio().toFixed(2)}× pixels\nPosition ${camera.position.x.toFixed(2)}, ${(-camera.position.z).toFixed(2)}`;}}
requestAnimationFrame(animate);
$('enter').onclick=()=>{started=true;$('loading').hidden=true;$('toolbar').hidden=false;$('hud').hidden=false;$('mobileControls').hidden=!mobileMode;notify(mobileMode?'Left thumb to walk · swipe the view to look around.':'WASD to walk. Drag the view to look around.');};
$('walk').onclick=beginWalk;$('helpButton').onclick=()=>{clearInput();controls.unlock();$('instructions').hidden=false;$('mobileControls').hidden=true;};$('closeHelp').onclick=()=>{$('instructions').hidden=true;$('mobileControls').hidden=!mobileMode||!started;};$('resume').onclick=()=>{$('instructions').hidden=true;$('mobileControls').hidden=!mobileMode||!started;beginWalk();};$('returnStreet').onclick=()=>visit(0);$('places').onchange=e=>{visit(+e.target.value);e.target.blur();};$('stats').onclick=()=>$('performance').hidden=!$('performance').hidden;
$('quality').onchange=e=>{quality=e.target.value;e.target.blur();renderer.setPixelRatio(Math.min(devicePixelRatio,mobileMode?(quality==='light'?.75:1):(quality==='high'?1.75:quality==='light'?1:1.35)));updateLODs();sun.shadow.needsUpdate=true;};
window.addEventListener('resize',()=>{clearInput();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
// Botaniq procedural colors do not survive the lightweight browser export.
// Supply botanical colors only for its untextured neutral placeholder materials.
function plantPreviewColor(m){
 if(m.texture||!m.name.startsWith('bq_')||!m.color.every(c=>Math.abs(c-.7)<.001))return new THREE.Color().setRGB(...m.color);
 const n=m.name.toLowerCase();let hex=0x53733a;
 if(n.includes('bark'))hex=0x66503a;
 else if(n.includes('stem'))hex=0x476532;
 else if(n.includes('grass'))hex=0x587d35;
 else if(n.includes('flower')){
  if(n.includes('inside'))hex=0x54321d;
  else if(/rudbeck|rudback|sunflower|verbascum/.test(n))hex=0xe4ae32;
  else if(/lavender|cornflower|bellflower|hosta/.test(n))hex=0x8c73b9;
  else if(/rose|digitalis|thymus/.test(n))hex=0xc76587;
  else if(n.includes('achillea'))hex=0xd6b674;
  else if(n.includes('phalaris'))hex=0xa39a62;
  else hex=0xd9c691;
 }
 return new THREE.Color(hex);
}
async function load(){
 data=await(await fetch(dataRoot+'scene.json',{cache:'no-cache'})).json();progress('Loading village geometry…',12);
 const [buffer,navbuffer]=await Promise.all([unpack((data.geometryChunks||['geometry.bin.gz']).map(file=>dataRoot+file+(data.runtimeVersion?'?v='+data.runtimeVersion:'')),loaded=>{const total=data.stats.compressedGeometryBytes;progress(`Loading village… ${Math.round(loaded/1e6)} / ${Math.round(total/1e6)} MB`,12+Math.min(28,loaded/total*28));}),unpack('./data/navigation.bin.gz')]);nav=new Uint8Array(navbuffer);progress('Preparing materials and planting…',40);
 const manager=new THREE.LoadingManager(),loader=new THREE.TextureLoader(manager),textures=new Map();const texPromises=[];
 const materials=data.materials.map(m=>{let map=null;if(m.texture){if(!textures.has(m.texture)){const texture=loader.load(dataRoot+m.texture,()=>{},undefined,()=>textureFails.push(m.texture));texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(mobileMode?2:4,renderer.capabilities.getMaxAnisotropy());textures.set(m.texture,texture);}map=textures.get(m.texture);}
  const mat=new THREE.MeshStandardMaterial({color:plantPreviewColor(m),map,roughness:m.roughness,metalness:0,side:THREE.DoubleSide,alphaTest:m.alphaTest,transparent:false});
  if(m.worldUV){mat.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (modelMatrix * vec4(position, 1.0)).xz * 0.85;\n#endif');};mat.customProgramCacheKey=()=> 'world-ground-uv';}
  return mat;});
 nearSources=await(await fetch(dataRoot+'near.json',{cache:'no-cache'})).json();
 const geometryCache=new Map();const geometry=data.geometries.map(g=>g.levels.map(l=>{const key=l.offset+':'+l.indexOffset;if(!geometryCache.has(key))geometryCache.set(key,makeGeometry(l,buffer));return geometryCache.get(key);}));
 for(const o of data.objects){const g=data.geometries[o.mesh],mat=g.materials.map(i=>materials[i]);const mesh=new THREE.Mesh(geometry[o.mesh][2],mat);mesh.name=o.name;const matrix=new THREE.Matrix4().set(...o.matrix).premultiply(worldRotation);mesh.applyMatrix4(matrix);mesh.matrixAutoUpdate=false;mesh.updateMatrixWorld();mesh.castShadow=!o.groundcover;mesh.receiveShadow=true;scene.add(mesh);rows.push({...o,meshId:o.mesh,center:point(o.center),geometries:geometry[o.mesh],fallback:geometry[o.mesh][0],mesh,level:2});}
 data.cameras.sort((a,b)=>a.name.localeCompare(b.name));for(const [i,v]of data.cameras.entries()){const option=document.createElement('option');option.value=i;option.textContent=v.name.replace(/^\d+ /,'');$('places').appendChild(option);}
 ready=true;visit(0);progress('Finishing textures…',75);
 await new Promise(resolve=>{if(manager.isLoading===false)resolve();else{manager.onLoad=resolve;setTimeout(resolve,12000);}});
 updateLODs();renderer.render(scene,camera);sun.shadow.autoUpdate=false;progress('Ready to explore.',100);$('enter').disabled=false;
 if(textureFails.length)notify(`${textureFails.length} textures could not load. Reload to try again.`);
 window.village={data,renderer,camera,rows,visit,canStand,blockedAt,stats:()=>({mobileMode,fps,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,mobileCachedSources:mobileNearCache.size,levels:drawnLODs,textureFails})};
}
load().catch(error=>{console.error(error);progress('The village could not load. '+error.message,0);$('enter').textContent='Reload';$('enter').disabled=false;$('enter').onclick=()=>location.reload();});

// Explicit developer review mode: realtime captures, never an offline render batch.
async function reviewAllViews(){
 const sheet=document.createElement('canvas');sheet.width=1500;sheet.height=1000;const ctx=sheet.getContext('2d');ctx.fillStyle='#152d24';ctx.fillRect(0,0,1500,1000);const metrics=[];
 renderer.setPixelRatio(1);renderer.setSize(375,220,false);camera.aspect=375/220;camera.updateProjectionMatrix();
 for(let i=0;i<data.cameras.length;i++){visit(i);const deadline=performance.now()+15000;while((nearActive||nearQueue.length)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));renderer.render(scene,camera);const x=(i%4)*375,y=Math.floor(i/4)*200;ctx.drawImage(renderer.domElement,x,y,375,180);ctx.fillStyle='#f7f0dc';ctx.font='12px system-ui';ctx.fillText(data.cameras[i].name,x+8,y+195);metrics.push({view:data.cameras[i].name,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,levels:[...drawnLODs]});await new Promise(resolve=>setTimeout(resolve,30));}
 window.reviewComplete=true;document.body.innerHTML='';document.body.style.overflow='auto';sheet.style.width='100%';sheet.style.height='auto';document.body.appendChild(sheet);const output=document.createElement('pre');output.textContent=JSON.stringify({textureFails,metrics},null,2);document.body.appendChild(output);document.title='18 views — browser pilot review';
}
if(new URLSearchParams(location.search).has('review')){
 const timer=setInterval(()=>{if(window.village){clearInterval(timer);reviewAllViews();}},300);
}
