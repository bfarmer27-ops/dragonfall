// Fireballs: a glowing core, an additive flame sprite, a smoke/ember trail, a point light on the high tier, and an
// explosion burst when they hit rock, a rider, or time out. Hit tests are simple distance checks the game feeds in.
import * as THREE from 'three';
import {TIER} from './quality.js';
function radialTexture(inner='rgba(255,240,200,1)',mid='rgba(255,120,30,.55)',outer='rgba(255,60,0,0)'){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const grad=g.createRadialGradient(64,64,0,64,64,64);
 grad.addColorStop(0,inner);grad.addColorStop(.35,mid);grad.addColorStop(1,outer);g.fillStyle=grad;g.fillRect(0,0,128,128);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export function createFireballs({scene,maxBalls=6,onExplode=()=>{}}={}){
 const high=TIER==='high';
 const glowTex=radialTexture(),smokeTex=radialTexture('rgba(90,70,60,.55)','rgba(60,50,45,.25)','rgba(40,35,30,0)');
 const glowMat=new THREE.SpriteMaterial({map:glowTex,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,fog:false});
 const coreMat=new THREE.MeshBasicMaterial({color:0xffe2a0,fog:false});
 const smokeMat=new THREE.SpriteMaterial({map:smokeTex,depthWrite:false,transparent:true,opacity:.7});
 const balls=[],particles=[];
 const trailPool=[];
 function particle(pos,vel,life,scale,mat){
  let s=trailPool.pop();if(!s){s=new THREE.Sprite(mat.clone());scene.add(s);}
  s.material=mat;s.position.copy(pos);s.scale.setScalar(scale);s.visible=true;
  particles.push({s,vel,life,age:0,scale0:scale});
 }
 const api={
  // origin/direction are world-space THREE.Vector3; speed in units/s; owner tags whose fireball it is (multiplayer).
  fire({origin,direction,speed=140,owner='me',range=520}){
   if(balls.length>=maxBalls)api.burst(balls.shift(),'timeout');
   const g=new THREE.Group();
   const core=new THREE.Mesh(new THREE.SphereGeometry(.9,12,10),coreMat);g.add(core);
   const glow=new THREE.Sprite(glowMat);glow.scale.setScalar(7);g.add(glow);
   let light=null;if(high){light=new THREE.PointLight(0xff8a30,60,90,2);g.add(light);}
   g.position.copy(origin);scene.add(g);
   const b={g,core,glow,light,vel:direction.clone().normalize().multiplyScalar(speed),owner,age:0,life:range/speed,alive:true};
   balls.push(b);return b;
  },
  // hits: (position:THREE.Vector3, ball) => 'rock' | 'rider' | 'player:<id>' | null ; called each step per live ball.
  update(dt,hits=()=>null){
   for(const b of balls.slice()){
    if(!b.alive)continue;
    b.age+=dt;b.g.position.addScaledVector(b.vel,dt);b.vel.y-=6*dt; // slight arc
    const pulse=1+Math.sin(b.age*40)*.12;b.glow.scale.setScalar(7*pulse);b.core.scale.setScalar(pulse);
    if(Math.random()<(high?.9:.5))particle(b.g.position.clone().addScaledVector(b.vel,-dt*.5),new THREE.Vector3((Math.random()-.5)*4,2+Math.random()*3,(Math.random()-.5)*4),.6+Math.random()*.5,1.6+Math.random()*1.2,Math.random()<.5?glowMat:smokeMat);
    const kind=hits(b.g.position,b);
    if(kind||b.age>b.life)api.burst(b,kind||'timeout');
   }
   for(const p of particles.slice()){
    p.age+=dt;p.s.position.addScaledVector(p.vel,dt);const k=p.age/p.life;p.s.scale.setScalar(p.scale0*(1+k*1.8));p.s.material.opacity=Math.max(0,(1-k))*(p.s.material===glowMat?1:.7);
    if(p.age>=p.life){p.s.visible=false;particles.splice(particles.indexOf(p),1);trailPool.push(p.s);}
   }
  },
  burst(b,kind){
   if(!b||!b.alive)return;b.alive=false;balls.splice(balls.indexOf(b),1);scene.remove(b.g);
   const n=high?26:12;for(let i=0;i<n;i++){const v=new THREE.Vector3((Math.random()-.5)*2,(Math.random()-.2)*2,(Math.random()-.5)*2).normalize().multiplyScalar(14+Math.random()*26);particle(b.g.position,v,.5+Math.random()*.6,3+Math.random()*3,i%3?glowMat:smokeMat);}
   onExplode(b.g.position.clone(),kind,b.owner);
  },
  get live(){return balls;},
  dispose(){for(const b of balls.slice())api.burst(b,'dispose');for(const p of particles)scene.remove(p.s);for(const s of trailPool)scene.remove(s);}
 };
 return api;
}
