import {createTilt} from './tilt.js';
import * as THREE from './vendor/three.module.js';
import {createDragon,mergeRigid} from './dragon.js';
import {createEnvironment} from './environment.js';
import {wingbeatPose} from './wingbeat.js';
import {clamp,damp,centerAt,newFlight,stepFlight,FLIGHT_SPEED_MULTIPLIER,PHYSICS_STEP} from './flight.js?v=5';
import {readInvertSetting,saveInvertSetting,invertVerticalControls,readControlMode,saveControlMode} from './control-settings.js?v=7';
import {renderPixelRatio} from './render-quality.js';
const $=id=>document.getElementById(id);
let viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('sky'),antialias:true,alpha:false,powerPreference:'high-performance'});}catch(e){$('error').hidden=false;throw e;}
renderer.setPixelRatio(renderPixelRatio(viewportWidth,viewportHeight,devicePixelRatio,renderer.capabilities.maxTextureSize));renderer.setSize(viewportWidth,viewportHeight,false);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x78979d,.0022);
const camera=new THREE.PerspectiveCamera(63,viewportWidth/viewportHeight,.2,2200);
scene.add(new THREE.HemisphereLight(0xb4d6d8,0x122428,.95));
const sunlight=new THREE.DirectionalLight(0xe2f1e7,2.4);sunlight.position.set(-200,250,-350);scene.add(sunlight);scene.add(sunlight.target);sunlight.castShadow=true;sunlight.shadow.mapSize.set(2048,2048);Object.assign(sunlight.shadow.camera,{left:-15,right:15,top:15,bottom:-15,near:1,far:150});sunlight.shadow.bias=-.0003;sunlight.shadow.normalBias=.035;sunlight.shadow.camera.updateProjectionMatrix();
const rim=new THREE.DirectionalLight(0x759cba,.65);rim.position.set(50,70,130);scene.add(rim);
const worldSlope=.04,chunkLength=100,chunkCount=23;
let flapPhase=0;
let flight=newFlight(),mode='intro',time=0,lastTime=performance.now(),toastTimer=0,uiTime=0,best=0;
try{best=Number(localStorage.getItem('dragonfall-best-v1'))||0;}catch{}
$('intro-best').textContent=Math.floor(best).toLocaleString()+' m';
const hash=(a,b=0)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};
const noise=(x,z)=>{const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),u),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);};
function terrainHeight(x,d){const a=Math.abs(x-centerAt(d)),edge=40+6*Math.sin(d*.014);if(a<edge)return -5;const q=a-edge;const ridge=1-Math.abs(noise(x*.010,d*.009)*2-1);const macro=82+75*ridge+38*noise(x*.024,d*.025);const cliff=(1-Math.exp(-q*.036))*macro;const detail=(noise(x*.16,d*.105)-.5)*5+(noise(x*.06,d*.045)-.5)*17;return 1+cliff+Math.pow(q,.73)*.72+detail*Math.min(1,q/12);}
const {sky,skyMaterial,cliffMat,waterMat}=createEnvironment(renderer,scene);
const chunks=[];
function makeTerrainChunk(index){const group=new THREE.Group();scene.add(group);let terrain=null,river=null;const slot={group,index,terrain,river};fillChunk(slot,index);return slot;}
function fillChunk(slot,index){slot.index=index;const start=index*chunkLength;slot.group.position.z=-start;slot.group.position.y=-start*worldSlope;
 const nx=144,nz=30,positions=[],colors=[],indices=[];
 for(let k=0;k<=nz;k++){const d=start+k*chunkLength/nz;for(let j=0;j<=nx;j++){const axis=j/nx*2-1;const offset=Math.sign(axis)*Math.pow(Math.abs(axis),1.7)*600;const x=centerAt(d)+offset;const y=terrainHeight(x,d);positions.push(x,y-(d-start)*worldSlope,-(d-start));const n=noise(x*.03,d*.03);const col=new THREE.Color().setRGB(.7+n*.25,.75+n*.2,.76+n*.19);colors.push(col.r,col.g,col.b);}}
 for(let k=0;k<nz;k++)for(let j=0;j<nx;j++){const a=k*(nx+1)+j,b=a+nx+1;indices.push(a,a+1,b,b,a+1,b+1);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
 if(slot.terrain){slot.terrain.geometry.dispose();slot.terrain.geometry=geo;}else{slot.terrain=new THREE.Mesh(geo,cliffMat);slot.terrain.receiveShadow=true;slot.group.add(slot.terrain);}
 const wp=[],wi=[];for(let k=0;k<=nz;k++){const d=start+k*chunkLength/nz,c=centerAt(d);wp.push(c-65,-(d-start)*worldSlope,-(d-start),c+65,-(d-start)*worldSlope,-(d-start));if(k<nz){const i=k*2;wi.push(i,i+1,i+2,i+2,i+1,i+3);}}
 const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));wg.setIndex(wi);wg.computeVertexNormals();if(slot.river){slot.river.geometry.dispose();slot.river.geometry=wg;}else{slot.river=new THREE.Mesh(wg,waterMat);slot.group.add(slot.river);}}
for(let i=-2;i<chunkCount-2;i++)chunks.push(makeTerrainChunk(i));
const model=createDragon(renderer);const {dragon,wings,tailSegments}=model;scene.add(dragon);
// Faint wingtip streamers make lift and banking legible at a glance.
const trailMaterial=new THREE.LineBasicMaterial({color:0xb2f4e5,transparent:true,opacity:.24,depthWrite:false});
const trails=[];for(let i=0;i<2;i++){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(22*3),3));const line=new THREE.Line(g,trailMaterial);line.frustumCulled=false;scene.add(line);trails.push({line,points:[]});}
const gates=[],gateGeo=new THREE.TorusGeometry(10.5,.13,7,64),haloGeo=new THREE.TorusGeometry(10.5,.52,6,64);
const gateMaterial=new THREE.MeshStandardMaterial({color:0xa7ffdc,emissive:0x66eec9,emissiveIntensity:2.4,roughness:.35,metalness:.4});
const haloMaterial=new THREE.MeshBasicMaterial({color:0x69edda,transparent:true,opacity:.12,depthWrite:false,blending:THREE.AdditiveBlending});
function setGate(g,n){g.n=n;g.d=160+n*185;g.x=centerAt(g.d)+Math.sin(n*1.8)*16;g.alt=27+Math.sin(n*.85)*10;g.passed=false;g.group.visible=true;g.group.position.set(g.x,g.alt-g.d*worldSlope,-g.d);g.group.rotation.z=0;}
for(let i=0;i<10;i++){const group=new THREE.Group();const ring=new THREE.Mesh(gateGeo,gateMaterial),halo=new THREE.Mesh(haloGeo,haloMaterial);group.add(ring,halo);const tickMat=new THREE.MeshBasicMaterial({color:0xd6ffe9});for(let j=0;j<4;j++){const tick=new THREE.Mesh(new THREE.OctahedronGeometry(.4,0),tickMat);tick.position.set(Math.cos(j*Math.PI/2)*10.5,Math.sin(j*Math.PI/2)*10.5,0);group.add(tick);}scene.add(group);mergeRigid(group);const gate={group};setGate(gate,i);gates.push(gate);}
const rockGeometry=new THREE.CylinderGeometry(1.4,2.8,1,6,3);const rp=rockGeometry.attributes.position;for(let i=0;i<rp.count;i++){rp.setX(i,rp.getX(i)*(1+hash(i,9)*.4));rp.setZ(i,rp.getZ(i)*(1+hash(i,2)*.4));}rockGeometry.computeVertexNormals();
const obstacles=[];
function setObstacle(o,n){o.n=n;o.d=300+n*240;o.x=centerAt(o.d)+(hash(n,3)-.5)*59;o.height=16+hash(n,5)*40;o.radius=3.1+hash(n,6)*2.4;o.mesh.position.set(o.x,o.height*.5-o.d*worldSlope,-o.d);o.mesh.scale.set(o.radius/2,o.height,o.radius/2);o.mesh.rotation.y=hash(n,7)*Math.PI;}
const rockMat=cliffMat.clone();rockMat.vertexColors=false;rockMat.onBeforeCompile=cliffMat.onBeforeCompile;
for(let i=0;i<9;i++){const mesh=new THREE.Mesh(rockGeometry,rockMat);scene.add(mesh);const o={mesh};setObstacle(o,i);obstacles.push(o);}
// Weathered stone arches frame the descent, like the narrow passages in the reference.
const archPoints=[];for(let i=0;i<=16;i++){const x=-55+i*110/16;archPoints.push(new THREE.Vector3(x,66*(1-(x/55)**2),Math.sin(i*.9)*2));}
const archGeometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPoints),48,6.7,7,false);const ap=archGeometry.attributes.position;for(let i=0;i<ap.count;i++){ap.setXYZ(i,ap.getX(i)+(hash(i,2)-.5)*2.1,ap.getY(i)+(hash(i,5)-.5)*2.1,ap.getZ(i)+(hash(i,9)-.5)*2.1);}archGeometry.computeVertexNormals();
const arches=[];function setArch(a,n){a.n=n;a.d=685+n*740;a.x=centerAt(a.d);a.mesh.position.set(a.x,-a.d*worldSlope,-a.d);}
for(let i=0;i<3;i++){const mesh=new THREE.Mesh(archGeometry,rockMat);scene.add(mesh);const a={mesh};setArch(a,i);arches.push(a);}
// Distant seabirds and suspended flecks establish depth without expensive postprocessing.
const dustCount=220,dustPos=new Float32Array(dustCount*3);const dustGeo=new THREE.BufferGeometry();dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPos,3));const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0xc2dfdd,size:.14,transparent:true,opacity:.42,depthWrite:false}));dust.frustumCulled=false;scene.add(dust);
const birdGeo=new THREE.BufferGeometry();const birdPts=[];for(let i=0;i<24;i++){const x=(hash(i,2)-.5)*170,y=70+hash(i,8)*100,z=-150-hash(i,1)*800;birdPts.push(x-1.7,y+.5,z,x,y,z+.4,x,y,z+.4,x+1.7,y+.5,z);}birdGeo.setAttribute('position',new THREE.Float32BufferAttribute(birdPts,3));const birds=new THREE.LineSegments(birdGeo,new THREE.LineBasicMaterial({color:0x263d42,transparent:true,opacity:.6}));scene.add(birds);
let controlMode=readControlMode(),invertVertical=readInvertSetting(controlMode);const tilt=createTilt();
const pointers={left:null,right:null},inputs={left:0,right:0},keys=new Set();
function updatePad(side,v,active){const el=$(side+'-wing');el.classList.toggle('active',active);el.querySelector('.thumb').style.top=(66-v*53)+'px';}
function resetInputs(){for(const side of ['left','right']){if(pointers[side]){try{$('game').releasePointerCapture(pointers[side].id);}catch{}}pointers[side]=null;inputs[side]=0;updatePad(side,0,false);}keys.clear();}
const padRange=()=>clamp(viewportHeight*.115,55,105);
$('game').addEventListener('pointerdown',e=>{if(controlMode==='tilt'||mode!=='playing'||e.target.closest('button')||e.target.closest('#modal'))return;const side=e.clientX<viewportWidth/2?'left':'right';if(pointers[side])return;pointers[side]={id:e.pointerId,y:e.clientY};$('game').setPointerCapture(e.pointerId);inputs[side]=0;updatePad(side,0,true);e.preventDefault();});
$('game').addEventListener('pointermove',e=>{for(const side of ['left','right']){const p=pointers[side];if(p?.id===e.pointerId){let v=clamp((p.y-e.clientY)/padRange(),-1,1);v=Math.abs(v)<.02?0:Math.sign(v)*(Math.abs(v)-.02)/.98;inputs[side]=v;updatePad(side,v,true);e.preventDefault();}}});
function pointerEnd(e){for(const side of ['left','right'])if(pointers[side]?.id===e.pointerId){pointers[side]=null;inputs[side]=0;updatePad(side,0,false);}}
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('game').addEventListener(event,pointerEnd);
addEventListener('keydown',e=>{if($('settings-dialog').open)return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Escape','w','s','W','S','i','k','I','K'].includes(e.key)){e.preventDefault();if(e.repeat&&[' ','Escape'].includes(e.key))return;if(e.key==='Escape'||e.key===' '){if(mode==='playing')pause();else if(mode==='paused')resume();else if(mode==='intro'&&e.key===' ')start();return;}keys.add(e.key.toLowerCase());}});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
function controls(){const t=controlMode==='tilt'?tilt.read():{pitch:0,bank:0};const pitch=t.pitch+(keys.has('arrowup')?1:0)-(keys.has('arrowdown')?1:0),turn=t.bank+(keys.has('arrowleft')?1:0)-(keys.has('arrowright')?1:0);const l=clamp(inputs.left+(keys.has('w')?1:0)-(keys.has('s')?1:0)+pitch-turn,-1,1),r=clamp(inputs.right+(keys.has('i')?1:0)-(keys.has('k')?1:0)+pitch+turn,-1,1);updatePad('left',l,!!pointers.left||l!==0);updatePad('right',r,!!pointers.right||r!==0);return invertVerticalControls(l,r,invertVertical);}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2000);}
function updateHealth(){document.querySelectorAll('.health i').forEach((el,i)=>el.classList.toggle('lost',i>=flight.health));document.querySelector('.health').setAttribute('aria-label',flight.health+' shields remaining');}
function saveBest(){if(flight.distance>best){best=Math.floor(flight.distance);try{localStorage.setItem('dragonfall-best-v1',String(best));}catch{}}}
async function start(){if(!await prepareControls())return;resetInputs();flapPhase=0;flight=newFlight();for(let i=0;i<chunks.length;i++)fillChunk(chunks[i],i-2);gates.forEach((g,i)=>setGate(g,i));obstacles.forEach((o,i)=>setObstacle(o,i));arches.forEach((a,i)=>setArch(a,i));trails.forEach(t=>t.points=[]);mode='playing';document.body.classList.add('playing');$('modal').hidden=true;updateHealth();updateUI();positionCamera(1,true);placeWingPads();toast(controlMode==='tilt'?'TILT TO STEER · LIFT TOP EDGE TO CLIMB':'THUMBS ON WINGS · FIND YOUR FLOW');if(audioEnabled)startAudio();}
function pause(){if(mode!=='playing')return;mode='paused';resetInputs();$('modal').hidden=false;$('modal-eyebrow').textContent='TAKE A BREATH';$('modal-title').textContent='Flight paused';$('modal-message').textContent='The canyon will wait.';$('run-stats').hidden=true;$('resume').innerHTML='RESUME FLIGHT <span>↗</span>';setAudioLevel(0);}
async function resume(){if(mode==='over'){start();return;}if(!await prepareControls())return;mode='playing';resetInputs();$('modal').hidden=true;lastTime=performance.now();if(audioEnabled)startAudio();}
function gameOver(){mode='over';saveBest();resetInputs();$('modal').hidden=false;$('modal-eyebrow').textContent=flight.distance>=best?'A NEW PERSONAL BEST':'THE DESCENT ENDS';$('modal-title').textContent='One more flight?';$('modal-message').textContent='Every turn brings you closer to the flow.';$('run-stats').hidden=false;$('final-distance').textContent=Math.floor(flight.distance).toLocaleString();$('final-gates').textContent=flight.gates;$('resume').innerHTML='FLY AGAIN <span>↗</span>';setAudioLevel(.015);}
function hit(reason){if(flight.invulnerable>0)return;flight.health--;flight.invulnerable=3;updateHealth();$('flash').style.opacity='1';setTimeout(()=>$('flash').style.opacity='0',220);if(navigator.vibrate)navigator.vibrate(70);if(audioEnabled)chime(95,.23);if(flight.health<=0){gameOver();return;}flight.alt=Math.max(flight.alt+9,18);flight.x=THREE.MathUtils.lerp(flight.x,centerAt(flight.distance),.48);flight.speed*=.8;toast(reason+' · '+flight.health+' SHIELDS LEFT');}
let resumeAfterSettings=false;
async function prepareControls(){if(controlMode!=='tilt')return true;try{await tilt.enable();$('tilt-status').textContent='Ready. Your current phone position is level flight.';return true;}catch(e){$('tilt-status').textContent=e.message;resumeAfterSettings=false;syncSettings();if(!$('settings-dialog').open)$('settings-dialog').showModal();return false;}}
function syncSettings(){
 const isTilt=controlMode==='tilt';
 $('control-mode').value=controlMode;$('tilt-options').hidden=!isTilt;
 document.body.classList.toggle('tilt-mode',isTilt);
 $('invert-vertical').checked=invertVertical;
 $('invert-description').textContent=isTilt?(invertVertical?'Lower the top edge to climb; lift it to dive.':'Lift the top edge to climb; lower it to dive.'):(invertVertical?'Slide both thumbs down to climb, up to dive.':'Slide both thumbs up to climb, down to dive.');
 $('climb-gesture').textContent=isTilt?(invertVertical?'LOWER':'LIFT'):(invertVertical?'↓ ↓':'↑ ↑');
 $('dive-gesture').textContent=isTilt?(invertVertical?'LIFT':'LOWER'):(invertVertical?'↑ ↑':'↓ ↓');
 $('bank-left-gesture').textContent=isTilt?'TILT ←':'↓ ↑';$('bank-right-gesture').textContent=isTilt?'TILT →':'↑ ↓';
 document.querySelector('.mobile-hint').textContent=isTilt?'Hold your phone comfortably, then tap Take flight. Tilt left/right to turn.':'Slide each thumb to steer. Rotate your phone for landscape.';
}
$('control-mode').addEventListener('change',()=>{controlMode=$('control-mode').value;saveControlMode(controlMode);invertVertical=readInvertSetting(controlMode);resetInputs();syncSettings();});
$('calibrate-tilt').onclick=async()=>{await prepareControls();};
$('settings').onclick=()=>{resumeAfterSettings=mode==='playing';if(resumeAfterSettings)pause();resetInputs();syncSettings();$('settings-dialog').showModal();};
$('invert-vertical').addEventListener('change',()=>{invertVertical=$('invert-vertical').checked;saveInvertSetting(invertVertical,controlMode);resetInputs();syncSettings();});
$('settings-dialog').addEventListener('close',()=>{resetInputs();if(resumeAfterSettings&&mode==='paused'&&!document.hidden)resume();resumeAfterSettings=false;});
syncSettings();
$('start').onclick=start;$('pause').onclick=pause;$('resume').onclick=resume;$('restart').onclick=start;
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});addEventListener('blur',()=>{resetInputs();pause();});
async function allowRotation(){try{screen.orientation?.unlock?.();if(document.fullscreenElement&&screen.orientation?.lock)await screen.orientation.lock('any');}catch{/* The browser may require device Auto-rotate to be enabled. */}}
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();}else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'});await allowRotation();}else{toast('ROTATE YOUR PHONE · ENABLE AUTO-ROTATE');}scheduleViewportResize();}catch{toast('ENABLE AUTO-ROTATE, THEN TURN YOUR PHONE');}};

let audioEnabled=false,audioContext,windGain,windFilter;
function startAudio(){try{if(!audioContext){audioContext=new (window.AudioContext||window.webkitAudioContext)();const buffer=audioContext.createBuffer(1,audioContext.sampleRate*3,audioContext.sampleRate),data=buffer.getChannelData(0);let p=0;for(let i=0;i<data.length;i++){p=(p+Math.random()*.04-.02)/1.02;data[i]=p*5;}const src=audioContext.createBufferSource();src.buffer=buffer;src.loop=true;windFilter=audioContext.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=600;windGain=audioContext.createGain();windGain.gain.value=0;src.connect(windFilter).connect(windGain).connect(audioContext.destination);src.start();}audioContext.resume();setAudioLevel(.14);}catch{audioEnabled=false;}}
function setAudioLevel(v){if(windGain)windGain.gain.setTargetAtTime(audioEnabled?v:0,audioContext.currentTime,.2);}
function chime(freq,duration){if(!audioContext)return;const osc=audioContext.createOscillator(),g=audioContext.createGain();osc.type='sine';osc.frequency.setValueAtTime(freq,audioContext.currentTime);osc.frequency.exponentialRampToValueAtTime(freq*1.4,audioContext.currentTime+duration);g.gain.setValueAtTime(.075,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);osc.connect(g).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+duration);}
$('sound').onclick=()=>{audioEnabled=!audioEnabled;if(audioEnabled)startAudio();else setAudioLevel(0);$('sound').setAttribute('aria-label',audioEnabled?'Mute sound':'Enable sound');$('sound-waves').setAttribute('d',audioEnabled?'M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14':'m16 9 6 6m0-6-6 6');};
const target=new THREE.Vector3(),desiredCamera=new THREE.Vector3(),lookTarget=new THREE.Vector3(),cameraAnchor=new THREE.Vector3(),newAnchor=new THREE.Vector3(),cameraTravel=new THREE.Vector3();
function positionCamera(dt,instant=false){const aspect=viewportWidth/viewportHeight,dist=aspect<.85?19:aspect<1.2?18:17,h=flight.alt-flight.distance*worldSlope;newAnchor.set(flight.x,h,-flight.distance);if(!instant){cameraTravel.subVectors(newAnchor,cameraAnchor);camera.position.add(cameraTravel);lookTarget.add(cameraTravel);}cameraAnchor.copy(newAnchor);const steeringLead=flight.vx/FLIGHT_SPEED_MULTIPLIER;desiredCamera.set(flight.x+steeringLead*.035,h+6.4,-flight.distance+dist);target.set(flight.x+clamp(steeringLead*.14,-7,7),h+1.5,-flight.distance-35);camera.position.lerp(desiredCamera,instant?1:1-Math.exp(-15*dt));lookTarget.lerp(target,instant?1:1-Math.exp(-12*dt));camera.up.set(-flight.roll*.06,1,0);camera.lookAt(lookTarget);const targetFov=(aspect<.85?67:61)+(flight.speed/FLIGHT_SPEED_MULTIPLIER-35)*.11;camera.fov=instant?targetFov:damp(camera.fov,targetFov,2,dt);camera.aspect=aspect;camera.updateProjectionMatrix();sky.position.copy(camera.position);}

function placeWingPads(){camera.updateMatrixWorld();for(const [side,x] of [['left',-3.9],['right',3.9]]){const p=new THREE.Vector3(flight.x+x,flight.alt-flight.distance*worldSlope+.2,-flight.distance-1).project(camera);const el=$(side+'-wing');el.style.left=((p.x*.5+.5)*100)+'%';el.style.top=((.5-p.y*.5)*viewportHeight+8)+'px';}}
function animateDragon(dt,l,r){const h=flight.alt-flight.distance*worldSlope;dragon.position.set(flight.x,h,-flight.distance);dragon.rotation.set(flight.pitch,flight.yaw,flight.roll,'YXZ');dragon.visible=!(flight.invulnerable>0&&Math.floor(time*12)%2===0);const pose=wingbeatPose(flapPhase,(l+r)*.5,flight.speed/FLIGHT_SPEED_MULTIPLIER);flapPhase+=dt*Math.PI*2*pose.frequency;dragon.position.y+=pose.body;model.update(pose,flight,l,r,time);dragon.updateMatrixWorld(true);for(let i=0;i<2;i++){const tip=model.wingTip(i,pose),t=trails[i];t.points.unshift(tip);if(t.points.length>22)t.points.pop();const pos=t.line.geometry.attributes.position;for(let j=0;j<22;j++){const v=t.points[Math.min(j,t.points.length-1)];pos.setXYZ(j,v.x,v.y,v.z);}pos.needsUpdate=true;t.line.visible=mode!=='over';}}

function updateWorld(dt){for(const c of chunks)if(c.index*chunkLength+chunkLength<flight.distance-170){fillChunk(c,c.index+chunkCount);}
 for(const g of gates){const relative=g.d-flight.distance;if(!g.passed&&relative<0){g.passed=true;if(mode==='playing'&&Math.hypot(flight.x-g.x,flight.alt-g.alt)<10.5){flight.gates++;flight.speed=Math.min(flight.speed+4*FLIGHT_SPEED_MULTIPLIER,72*FLIGHT_SPEED_MULTIPLIER);g.group.visible=false;toast(flight.gates%5===0?'BEAUTIFUL LINE · '+flight.gates+' GATES':'GATE CAUGHT +1');if(audioEnabled)chime(600+flight.gates%5*90,.32);}}if(relative< -100)setGate(g,g.n+gates.length);g.group.rotation.z+=dt*.12;const pulse=1+Math.sin(time*1.9+g.n)*.015;g.group.scale.setScalar(pulse);}
 for(const o of obstacles){const relative=o.d-flight.distance;const bodyRadius=o.radius*(1.4-.7*clamp(flight.alt/o.height,0,1))*1.2;if(mode==='playing'&&Math.hypot(relative,flight.x-o.x)<bodyRadius+1.4&&flight.alt<o.height+1.5)hit('ROCK GRAZE');if(relative< -130)setObstacle(o,o.n+obstacles.length);}
 for(const a of arches){const rel=a.d-flight.distance,x=flight.x-a.x;const top=66*(1-(x/55)**2);if(mode==='playing'&&Math.abs(rel)<9&&Math.abs(x)<56&&Math.abs(flight.alt-top)<8)hit('ARCH GRAZE');if(rel< -160)setArch(a,a.n+arches.length);}
 if(mode==='playing'){const ground=terrainHeight(flight.x,flight.distance);if(flight.alt<3)hit('WATER GRAZE');else if(flight.alt<ground+1.8)hit('CLIFF GRAZE');if(flight.alt>84&&flight.elapsed%4<dt)toast('THIN AIR · LOWER YOUR WINGS');}
}
function updateAtmosphere(){for(let i=0;i<dustCount;i++){const travel=(time*(5+hash(i,3)*14)+hash(i,7)*280)%280;dustPos[i*3]=flight.x+(hash(i,4)-.5)*180;dustPos[i*3+1]=flight.alt-flight.distance*worldSlope+(hash(i,8)-.5)*80;dustPos[i*3+2]=-flight.distance-240+travel;}dustGeo.attributes.position.needsUpdate=true;birds.position.set(centerAt(flight.distance),-flight.distance*worldSlope,-flight.distance-Math.sin(time*.06)*100);}
function updateUI(){$('meters').textContent=Math.floor(flight.distance).toLocaleString();$('speed').textContent=Math.round(flight.speed*3.6);$('altitude').textContent=Math.max(0,Math.round(flight.alt));$('gates').textContent=flight.gates;}
let resizeFrame=0,rotationTimer=0;
function resizeViewport(){resizeFrame=0;const rect=$('game').getBoundingClientRect();const width=Math.max(1,Math.round(rect.width||window.innerWidth)),height=Math.max(1,Math.round(rect.height||window.innerHeight));const changed=width!==viewportWidth||height!==viewportHeight;if(!changed)return;const rotated=(width>height)!==(viewportWidth>viewportHeight);viewportWidth=width;viewportHeight=height;renderer.setPixelRatio(renderPixelRatio(width,height,devicePixelRatio,renderer.capabilities.maxTextureSize));renderer.setSize(width,height,false);if(rotated)resetInputs();positionCamera(1,true);placeWingPads();}
function scheduleViewportResize(){if(!resizeFrame)resizeFrame=requestAnimationFrame(resizeViewport);}
function handleRotation(){tilt.rotate();resetInputs();scheduleViewportResize();clearTimeout(rotationTimer);rotationTimer=setTimeout(resizeViewport,250);}
addEventListener('resize',scheduleViewportResize);addEventListener('orientationchange',handleRotation);window.visualViewport?.addEventListener('resize',scheduleViewportResize);window.screen?.orientation?.addEventListener('change',handleRotation);document.addEventListener('fullscreenchange',()=>{allowRotation();handleRotation();$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');});if(typeof ResizeObserver!=='undefined')new ResizeObserver(scheduleViewportResize).observe($('game'));allowRotation();

positionCamera(1,true);updateUI();
function frame(now){requestAnimationFrame(frame);const dt=clamp((now-lastTime)/1000,0,.1);lastTime=now;time+=dt;let l=0,r=0;
 if(mode==='playing'){[l,r]=controls();const steps=Math.max(1,Math.ceil(dt/PHYSICS_STEP)),step=dt/steps;for(let i=0;i<steps&&mode==='playing';i++){stepFlight(flight,l,r,step);updateWorld(step);}}
 else if(mode==='intro'){flight.distance+=dt*20*FLIGHT_SPEED_MULTIPLIER;flight.x=centerAt(flight.distance);flight.alt=29+Math.sin(time*.28)*2;flight.roll=Math.cos(time*.28)*.05;flight.yaw=0;flight.speed=32*FLIGHT_SPEED_MULTIPLIER;updateWorld(dt);}
 if(mode==='playing'||mode==='intro'){animateDragon(dt,l,r);positionCamera(dt);updateAtmosphere();}
 waterMat.uniforms.uDragon.value.copy(dragon.position);sunlight.position.set(dragon.position.x-35,dragon.position.y+65,dragon.position.z-40);sunlight.target.position.copy(dragon.position);waterMat.uniforms.uTime.value=time;waterMat.uniforms.uCamera.value.copy(camera.position);skyMaterial.uniforms.uTime.value=time;
 uiTime+=dt;if(uiTime>.12){uiTime=0;if(mode==='playing')updateUI();if(audioEnabled&&mode==='playing'){const windSpeed=flight.speed/FLIGHT_SPEED_MULTIPLIER;setAudioLevel(.08+windSpeed*.0025);windFilter.frequency.setTargetAtTime(350+windSpeed*11,audioContext.currentTime,.3);}}
 renderer.render(scene,camera);
}

requestAnimationFrame(frame);
