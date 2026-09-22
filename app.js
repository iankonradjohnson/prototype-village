import * as THREE from 'three';
import { PointerLockControls } from './vendor/PointerLockControls.js';
import { bindWalkInput } from './touch-controls.js?v=performance-1';
import { createRenderLoop } from './render-loop.js';
import { unpack } from './load-binary.js';
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
const scene=new THREE.Scene();scene.background=new THREE.Color('#b7cbd0');scene.fog=new THREE.Fog('#b7cbd0',mobileMode?80:150,mobileMode?210:320);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,mobileMode?240:360);
const controls=new PointerLockControls(camera,renderer.domElement);controls.pointerSpeed=.72;
const hemi=new THREE.HemisphereLight('#e4efff','#767251',2);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff0ca',3.1);sun.position.set(-40,85,5);sun.target.position.set(-15,0,-15);scene.add(sun,sun.target);
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-85;sun.shadow.camera.right=85;sun.shadow.camera.top=95;sun.shadow.camera.bottom=-95;sun.shadow.camera.near=1;sun.shadow.camera.far=220;sun.shadow.bias=-.0002;sun.shadow.normalBias=.04;
const worldRotation=new THREE.Matrix4().makeRotationX(-Math.PI/2), rows=[], keys=new Set();
let data,nav,ready=false,started=false,overview=false,sampleAt=performance.now(),frames=0,fps=0,lodAt=0,quality='balanced',drawnLODs=[0,0,0], culled=0,textureFails=[];
let requestForestHigh=null,requestForestMedium=null;
let lodDirty=true,renderedFrames=0;
const loadStartedAt=performance.now(),pendingTextures=new Set();
let readyAt=0,baseDetailSpecs=[],baseDetailActive=0;
const baseDetailPending=new Set(),baseDetailReady=new Set(),baseDetailQueue=[],baseDetailRetry=new Map();
const forestTrunks=[];
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
function pumpNear(){while(nearActive<(mobileMode?2:3)&&nearQueue.length){const r=nearQueue.shift(),spec=nearSources[r.meshId];if(mobileMode&&!mobileWanted.has(r.meshId)){nearPending.delete(r.meshId);continue;}nearActive++;unpack(dataRoot+spec.file+(data.runtimeVersion?'?v='+data.runtimeVersion:'')).then(buffer=>{const geometry=makeGeometry(spec.level,buffer);r.geometries[0]=geometry;if(mobileMode)mobileNearCache.set(r.meshId,geometry);nearReady.add(r.meshId);trimMobileNear();invalidate(true);}).catch(error=>{nearFailures.set(r.meshId,performance.now()+30000);console.warn('Near detail unavailable',error.message);}).finally(()=>{nearPending.delete(r.meshId);nearActive--;pumpNear();});}}
const vec=new THREE.Vector3(),v2=new THREE.Vector3(),euler=new THREE.Euler(0,0,0,'YXZ');
function notify(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notice').hidden=true,6500);}
function progress(message,pct){$('loadStatus').textContent=message;$('progressFill').style.width=pct+'%';}
function point(v){return new THREE.Vector3(v[0],v[2],-v[1]);}
function blockedAt(x,z){const n=data.navigation;const ix=Math.floor((x-n.origin[0])/n.step),iy=Math.floor((-z-n.origin[1])/n.step);if(ix<1||iy<1||ix>=n.width-1||iy>=n.height-1)return true;return nav[iy*n.width+ix]!==0;}
function canStand(x,z){const b=data.navigation.bounds||[-71,-39,55,79];if(x<b[0]||x>b[2]||-z<b[1]||-z>b[3])return false;if(forestTrunks.some(t=>(x-t.x)**2+(z-t.z)**2<t.radius**2))return false;for(const [dx,dz]of [[0,0],[.19,0],[-.19,0],[0,.19],[0,-.19]])if(blockedAt(x+dx,z+dz))return false;return true;}
function nearestClear(p){if(canStand(p.x,p.z))return p;for(let r=.25;r<4;r+=.25)for(let a=0;a<Math.PI*2;a+=Math.PI/8){let x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;if(canStand(x,z))return new THREE.Vector3(x,p.y,z);}return p;}
function visit(index){if(!ready)return;input.reset();keys.clear();const view=data.cameras[index];overview=view.overview;let pos=point(view.position);if(!overview){pos.y=1.72;}camera.position.copy(pos);camera.lookAt(point(view.target));camera.updateMatrixWorld();$('location').textContent=view.name.replace(/^\d+ /,'');$('places').value=index;$('walk').textContent=overview?'Return to street ↗':'Walk here ↗';invalidate();}
function beginWalk(){if(overview)visit(0);if(!mobileMode)controls.lock();}
controls.addEventListener('change',()=>invalidate());
controls.addEventListener('lock',()=>{$('crosshair').hidden=false;$('instructions').hidden=true;keys.clear();invalidate();});
controls.addEventListener('unlock',()=>{$('crosshair').hidden=true;keys.clear();invalidate();});
document.addEventListener('pointerlockerror',()=>notify('Mouse capture is unavailable here. Drag the view to look around; WASD still walks.'));
const input=bindWalkInput({canvas:renderer.domElement,joystick:$('joystick'),knob:$('joystickKnob'),enabled:()=>started&&$('instructions').hidden&&!controls.isLocked,look:(dx,dy)=>{euler.setFromQuaternion(camera.quaternion);euler.y-=dx*.003;euler.x=THREE.MathUtils.clamp(euler.x-dy*.003,-1.5,1.5);camera.quaternion.setFromEuler(euler);invalidate();},change:()=>invalidate()});
function clearInput(){keys.clear();input.reset();invalidate();}
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();frameLoop.setHidden(document.hidden);if(!document.hidden)invalidate();});
renderer.domElement.addEventListener('webglcontextrestored',()=>invalidate(true));
window.addEventListener('keydown',e=>{if(['SELECT','INPUT'].includes(document.activeElement.tagName))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){const first=!keys.has(e.code);keys.add(e.code);if(first){move(.03);invalidate();}e.preventDefault();}if(e.code==='KeyR'&&ready)visit(0);});
window.addEventListener('keyup',e=>{if(keys.delete(e.code))invalidate();});
function updateLODs(){const mobileCandidates=[];camera.updateMatrixWorld();viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);viewFrustum.setFromProjectionMatrix(viewProjection);drawnLODs=[0,0,0];culled=0;let factor=(quality==='high'?1.65:quality==='light'?.62:1)*(mobileMode?.65:1);
 for(const r of rows){const dist=Math.max(0,camera.position.distanceTo(r.center)-r.radius*.45);let near=r.plant?(r.radius>3?23:9):29,mid=r.plant?(r.radius>3?58:23):72,far=r.groundcover?36:r.plant&&r.radius<3?75:260;if(r.groundcover){near=6;mid=16;}if(r.forest){near=35;mid=95;far=340;}
  const level=dist<near*factor?0:dist<mid*factor?1:2,visible=(dist<far*factor||!r.plant)&&(!mobileMode||dist<(r.forest?215:r.groundcover?20:r.plant&&r.radius<3?40:115));
  if(r.mesh.visible!==visible&&r.mesh.castShadow)sun.shadow.needsUpdate=true;r.mesh.visible=visible;if(!visible){culled++;continue;}drawnLODs[level]++;if(r.level!==level||r.mesh.geometry!==r.geometries[level]){r.mesh.geometry=r.geometries[level];r.level=level;if(r.mesh.castShadow)sun.shadow.needsUpdate=true;}const inView=viewFrustum.intersectsObject(r.mesh);if(inView||(r.mesh.castShadow&&dist<45&&r.mesh.material.some(mat=>mat.alphaTest>0))){for(const mat of r.mesh.material)mat.userData.ensureTexture?.();}if(inView){if(started&&level<2&&!r.forest)requestBaseDetail(r);if(started&&r.forest&&level<2)requestForestMedium?.();}if(started&&level===0&&r.plant&&inView){if(r.forest){requestForestHigh?.();}else if(mobileMode&&!r.groundcover)mobileCandidates.push({r,dist});else if(!mobileMode)requestNear(r);}
 }
 if(mobileMode){mobileCandidates.sort((a,b)=>a.dist-b.dist);const chosen=[];mobileWanted=new Set();for(const item of mobileCandidates){if(mobileWanted.has(item.r.meshId))continue;mobileWanted.add(item.r.meshId);chosen.push(item.r);if(chosen.length===40)break;}for(const r of chosen){if(mobileNearCache.has(r.meshId)){const g=mobileNearCache.get(r.meshId);mobileNearCache.delete(r.meshId);mobileNearCache.set(r.meshId,g);}requestNear(r);}trimMobileNear();}
}
function move(dt){if(!started||!$('instructions').hidden)return false;const forward=input.movement.forward+(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),side=input.movement.side+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);if(!forward&&!side)return false;
 const oldX=camera.position.x,oldZ=camera.position.z;
 camera.getWorldDirection(vec);vec.y=0;vec.normalize();v2.crossVectors(vec,camera.up).normalize();const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?4.5:2.3)*(overview?7:1)*dt/Math.max(1,Math.hypot(forward,side));const dx=(vec.x*forward+v2.x*side)*speed,dz=(vec.z*forward+v2.z*side)*speed;
 if(overview){camera.position.x+=dx;camera.position.z+=dz;return true;}
 // Axis separation permits sliding along walls, with substeps preventing tunnelling.
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.09));for(let i=0;i<steps;i++){if(canStand(camera.position.x+dx/steps,camera.position.z))camera.position.x+=dx/steps;if(canStand(camera.position.x,camera.position.z+dz/steps))camera.position.z+=dz/steps;}
 return camera.position.x!==oldX||camera.position.z!==oldZ;
}
function showStats(idle=false){
 $('stats').textContent=`${idle?'Idle':fps+' fps'} · ${(renderer.info.render.triangles/1000).toFixed(0)}k triangles`;
 $('performance').textContent=`Measured in this browser\n${idle?'Idle — rendering paused':fps+' frames / second'}\n${renderedFrames} total frames rendered\n${renderer.info.render.triangles.toLocaleString()} triangles drawn\n${renderer.info.render.calls} draw calls\nLOD near / mid / far: ${drawnLODs.join(' / ')}\n${culled} small distant plants hidden\n${quality} detail · ${renderer.getPixelRatio().toFixed(2)}× pixels\nReady in ${((readyAt-loadStartedAt)/1000).toFixed(1)}s\nPosition ${camera.position.x.toFixed(2)}, ${(-camera.position.z).toFixed(2)}`;
}
function invalidate(shadows=false){lodDirty=true;if(shadows)sun.shadow.needsUpdate=true;frameLoop.invalidate();}
const frameLoop=createRenderLoop({maxFps:mobileMode?30:60,onIdle:()=>{if(ready)showStats(true);},step:(now,dt,changed)=>{
 if(window.reviewComplete||!ready)return false;
 const moved=move(dt);if(moved)lodDirty=true;
 let lodUpdated=false;if(lodDirty&&(!moved||now-lodAt>=150)){lodDirty=false;updateLODs();lodAt=now;lodUpdated=true;}
 if(changed||moved||lodUpdated){renderer.render(scene,camera);renderedFrames++;frames++;if(now-sampleAt>=1000){fps=Math.round(frames*1000/(now-sampleAt));frames=0;sampleAt=now;showStats();}}
 return moved;
}});
frameLoop.setHidden(document.hidden);
function requestBaseDetail(r){const id=r.meshId,spec=baseDetailSpecs[id];if(!spec||baseDetailPending.has(id)||baseDetailReady.has(id)||(baseDetailRetry.get(id)||0)>performance.now())return;baseDetailPending.add(id);baseDetailQueue.push(r);pumpBaseDetail();}
function pumpBaseDetail(){while(baseDetailActive<3&&baseDetailQueue.length){const r=baseDetailQueue.shift(),id=r.meshId,spec=baseDetailSpecs[id];baseDetailActive++;unpack('./data/startup/'+spec.file).then(buffer=>{const cache=new Map(),levels=spec.levels.map(l=>{const key=l.offset+':'+l.indexOffset;if(!cache.has(key))cache.set(key,makeGeometry(l,buffer));return cache.get(key);});if(!nearReady.has(id))r.geometries[0]=levels[0];r.geometries[1]=levels[1];baseDetailReady.add(id);invalidate(true);}).catch(error=>{baseDetailRetry.set(id,performance.now()+30000);console.warn('Finer village detail unavailable',error.message);}).finally(()=>{baseDetailPending.delete(id);baseDetailActive--;pumpBaseDetail();});}}
$('enter').onclick=()=>{started=true;$('loading').hidden=true;$('toolbar').hidden=false;$('hud').hidden=false;$('mobileControls').hidden=!mobileMode;sampleAt=performance.now();frames=0;invalidate();notify(mobileMode?'Left thumb to walk · swipe the view to look around.':'WASD to walk. Drag the view to look around.');};
$('walk').onclick=beginWalk;$('helpButton').onclick=()=>{clearInput();controls.unlock();$('instructions').hidden=false;$('mobileControls').hidden=true;};$('closeHelp').onclick=()=>{$('instructions').hidden=true;$('mobileControls').hidden=!mobileMode||!started;};$('resume').onclick=()=>{$('instructions').hidden=true;$('mobileControls').hidden=!mobileMode||!started;beginWalk();};$('returnStreet').onclick=()=>visit(0);$('places').onchange=e=>{visit(+e.target.value);e.target.blur();};$('stats').onclick=()=>$('performance').hidden=!$('performance').hidden;
$('quality').onchange=e=>{quality=e.target.value;e.target.blur();renderer.setPixelRatio(Math.min(devicePixelRatio,mobileMode?(quality==='light'?.75:1):(quality==='high'?1.75:quality==='light'?1:1.35)));invalidate();};
window.addEventListener('resize',()=>{clearInput();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);invalidate();});
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
function createMaterials(specs,root,loader){
 const textures=new Map();
 return specs.map(m=>{
  const mat=new THREE.MeshStandardMaterial({color:plantPreviewColor(m),roughness:m.roughness,metalness:0,side:THREE.DoubleSide,alphaTest:m.alphaTest,transparent:false});
  if(m.texture){
   if(!textures.has(m.texture))textures.set(m.texture,{texture:null,promise:null});
   const shared=textures.get(m.texture);
   mat.userData.ensureTexture=()=>{
    if(!shared.promise){
     shared.promise=new Promise(resolve=>{shared.texture=loader.load(root+m.texture,()=>{invalidate(true);resolve();},undefined,()=>{textureFails.push(m.texture);invalidate();resolve();});
      shared.texture.colorSpace=THREE.SRGBColorSpace;shared.texture.wrapS=shared.texture.wrapT=THREE.RepeatWrapping;shared.texture.anisotropy=Math.min(mobileMode?2:4,renderer.capabilities.getMaxAnisotropy());});
     pendingTextures.add(shared.promise);shared.promise.finally(()=>pendingTextures.delete(shared.promise));
    }
    if(mat.map!==shared.texture){mat.map=shared.texture;mat.needsUpdate=true;}
    return shared.promise;
   };
  }
  if(m.worldUV){mat.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (modelMatrix * vec4(position, 1.0)).xz * 0.85;\n#endif');};mat.customProgramCacheKey=()=> 'world-ground-uv';}
  return mat;
 });
}
async function prepareWoodland(){
 const root='./data/forest/';
 const response=await fetch(root+'scene.json?v=forest-2');if(!response.ok)throw new Error('Woodland could not load');
 const forest=await response.json();
 return {forest,buffer:await unpack(forest.geometryFiles[2].map(file=>root+file))};
}
async function loadWoodland(loader,{forest,buffer}){
 const root='./data/forest/',buffers={2:buffer};
 const mats=createMaterials(forest.materials,root,loader);
 const geos=forest.geometries.map(g=>g.levels.map((l,i)=>i===2?makeGeometry(l,buffers[i]):null));
 for(const levels of geos)levels[0]=levels[1]=levels[2];
 let mediumPromise=null;requestForestMedium=()=>{if(!mediumPromise)mediumPromise=unpack(forest.geometryFiles[1].map(file=>root+file)).then(buffer=>{forest.geometries.forEach((g,i)=>{geos[i][0]=geos[i][1]=makeGeometry(g.levels[1],buffer);});invalidate();}).catch(error=>{console.warn('Middle woodland detail unavailable',error.message);});return mediumPromise;};
 if(!mobileMode)requestForestHigh=()=>{requestForestHigh=null;requestForestMedium().then(()=>unpack(forest.geometryFiles[0].map(file=>root+file))).then(buffer=>{forest.geometries.forEach((g,i)=>{geos[i][0]=makeGeometry(g.levels[0],buffer);});invalidate();}).catch(error=>console.warn('Higher woodland detail unavailable',error.message));};
 for(const o of forest.objects){
  forestTrunks.push({x:o.matrix[3],z:-o.matrix[7],radius:o.trunkRadius||.8});
  const g=forest.geometries[o.mesh],mesh=new THREE.Mesh(geos[o.mesh][2],g.materials.map(i=>mats[i]));
  mesh.name=o.name;mesh.applyMatrix4(new THREE.Matrix4().set(...o.matrix).premultiply(worldRotation));mesh.matrixAutoUpdate=false;mesh.updateMatrixWorld();
  mesh.castShadow=false;mesh.receiveShadow=true;scene.add(mesh);
  rows.push({...o,meshId:data.geometries.length+o.mesh,center:point(o.center),geometries:geos[o.mesh],fallback:geos[o.mesh][1],mesh,level:2});
 }
 const base=rows.find(r=>r.name===forest.ground_override.name);
 if(base){const g=forest.ground_override;base.mesh.matrix.copy(new THREE.Matrix4().set(...g.matrix).premultiply(worldRotation));base.mesh.matrixWorldNeedsUpdate=true;base.mesh.updateMatrixWorld();base.center=point(g.center);base.radius=g.radius;}
}
async function load(){
 const navPromise=unpack('./data/navigation.bin.gz'),woodlandPromise=prepareWoodland();
 const nearPromise=fetch(dataRoot+'near.json',{cache:'no-cache'}).then(r=>r.json());
 const startupPromise=mobileMode?Promise.resolve(null):fetch('./data/startup/scene.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Village could not load');return r.json();});
 data=await(await fetch(dataRoot+'scene.json',{cache:'no-cache'})).json();progress('Loading village geometry…',12);
 const startup=await startupPromise;
 const root=startup?'./data/startup/':dataRoot;
 const files=startup?startup.geometryFiles:(data.geometryChunks||['geometry.bin.gz']);
 const total=startup?startup.compressedGeometryBytes:data.stats.compressedGeometryBytes;
 const [buffer,navbuffer,near,woodland]=await Promise.all([unpack(files.map(file=>root+file),loaded=>{progress(`Loading village… ${Math.round(loaded/1e6)} / ${Math.round(total/1e6)} MB`,12+Math.min(35,loaded/total*35));}),navPromise,nearPromise,woodlandPromise]);
 nav=new Uint8Array(navbuffer);nearSources=near;progress('Preparing your first view…',50);
 const loader=new THREE.TextureLoader();const materials=createMaterials(data.materials,dataRoot,loader);
 const geometryCache=new Map();
 const geometry=data.geometries.map((g,id)=>{
  if(startup){const level=makeGeometry(startup.geometries[id].level,buffer);baseDetailSpecs[id]=startup.geometries[id].detail;return [level,level,level];}
  return g.levels.map(l=>{const key=l.offset+':'+l.indexOffset;if(!geometryCache.has(key))geometryCache.set(key,makeGeometry(l,buffer));return geometryCache.get(key);});
 });
 for(const o of data.objects){const g=data.geometries[o.mesh],mat=g.materials.map(i=>materials[i]);const mesh=new THREE.Mesh(geometry[o.mesh][2],mat);mesh.name=o.name;const matrix=new THREE.Matrix4().set(...o.matrix).premultiply(worldRotation);mesh.applyMatrix4(matrix);mesh.matrixAutoUpdate=false;mesh.updateMatrixWorld();mesh.castShadow=!o.groundcover;mesh.receiveShadow=true;scene.add(mesh);rows.push({...o,meshId:o.mesh,center:point(o.center),geometries:geometry[o.mesh],fallback:geometry[o.mesh][0],mesh,level:2});}
 data.cameras.sort((a,b)=>a.name.localeCompare(b.name));for(const [i,v]of data.cameras.entries()){const option=document.createElement('option');option.value=i;option.textContent=v.name.replace(/^\d+ /,'');$('places').appendChild(option);}
 progress('Adding the surrounding woodland…',65);await loadWoodland(loader,woodland);
 ready=true;visit(0);updateLODs();progress('Finishing your first view…',85);
 // Promises are registered when visible textures start, including cached completions.
 await Promise.all([...pendingTextures]);
 readyAt=performance.now();sun.shadow.autoUpdate=false;invalidate(true);progress('Ready to explore.',100);$('enter').disabled=false;
 if(textureFails.length)notify(`${textureFails.length} textures could not load. Reload to try again.`);
 window.village={data,renderer,camera,rows,visit,canStand,blockedAt,stats:()=>({mobileMode,fps,renderedFrames,renderLoop:frameLoop.state(),readyMs:readyAt-loadStartedAt,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,mobileCachedSources:mobileNearCache.size,levels:drawnLODs,textureFails})};
}
load().catch(error=>{console.error(error);progress('The village could not load. '+error.message,0);$('enter').textContent='Reload';$('enter').disabled=false;$('enter').onclick=()=>location.reload();});

// Explicit developer review mode: realtime captures, never an offline render batch.
async function reviewAllViews(){
 started=true;
 const sheet=document.createElement('canvas');sheet.width=1500;sheet.height=1000;const ctx=sheet.getContext('2d');ctx.fillStyle='#152d24';ctx.fillRect(0,0,1500,1000);const metrics=[];
 renderer.setPixelRatio(1);renderer.setSize(375,220,false);camera.aspect=375/220;camera.updateProjectionMatrix();
 for(let i=0;i<data.cameras.length;i++){visit(i);updateLODs();const deadline=performance.now()+15000;while((nearActive||nearQueue.length||baseDetailActive||baseDetailQueue.length||pendingTextures.size)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));renderer.render(scene,camera);const x=(i%4)*375,y=Math.floor(i/4)*200;ctx.drawImage(renderer.domElement,x,y,375,180);ctx.fillStyle='#f7f0dc';ctx.font='12px system-ui';ctx.fillText(data.cameras[i].name,x+8,y+195);metrics.push({view:data.cameras[i].name,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,levels:[...drawnLODs]});await new Promise(resolve=>setTimeout(resolve,30));}
 window.reviewComplete=true;frameLoop.dispose();document.body.innerHTML='';document.body.style.overflow='auto';sheet.style.width='100%';sheet.style.height='auto';document.body.appendChild(sheet);const output=document.createElement('pre');output.textContent=JSON.stringify({textureFails,metrics},null,2);document.body.appendChild(output);document.title='18 views — browser pilot review';
}
if(new URLSearchParams(location.search).has('review')){
 const timer=setInterval(()=>{if(window.village){clearInterval(timer);reviewAllViews();}},300);
}
