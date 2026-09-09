import * as THREE from './vendor/three.module.js';
export function mergeRigid(group){
 const batches=new Map();for(const mesh of group.children.filter(c=>c.isMesh&&!c.isSkinnedMesh)){if(!batches.has(mesh.material))batches.set(mesh.material,[]);batches.get(mesh.material).push(mesh);}
 for(const [material,meshes] of batches){if(meshes.length<2)continue;const data={position:[],normal:[],uv:[],color:[]};for(const mesh of meshes){mesh.updateMatrix();let g=mesh.geometry.clone().applyMatrix4(mesh.matrix);if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}for(const key in data){const count=g.attributes.position.count,size=key==='uv'?2:3,a=g.attributes[key];if(a)for(const v of a.array)data[key].push(v);else for(let i=0;i<count*size;i++)data[key].push(key==='color'?1:0);}g.dispose();group.remove(mesh);}const geo=new THREE.BufferGeometry();for(const key in data)geo.setAttribute(key,new THREE.Float32BufferAttribute(data[key],key==='uv'?2:3));group.add(new THREE.Mesh(geo,material));}
}
function geometry(pos,indices,uv,colors){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(indices);if(uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;}
function loft(profile,rings=80,sides=32){
 const pos=[],uv=[],idx=[],colors=[];const z0=profile[0][0],z1=profile[profile.length-1][0];
 for(let i=0;i<=rings;i++){const z=z0+(z1-z0)*i/rings;let k=0;while(k<profile.length-2&&z>profile[k+1][0])k++;const a=profile[k],b=profile[k+1];let t=(z-a[0])/(b[0]-a[0]);t=t*t*(3-2*t);const w=a[1]+(b[1]-a[1])*t,h=a[2]+(b[2]-a[2])*t,y=a[3]+(b[3]-a[3])*t;
  for(let j=0;j<=sides;j++){const angle=j/sides*Math.PI*2,upper=Math.sin(angle);pos.push(Math.cos(angle)*w,y+upper*h,z);uv.push(j/sides*2,i/rings*2.8);const belly=Math.max(0,-upper);colors.push(.88+belly*.12,.88+belly*.07,.87-belly*.02);if(i<rings&&j<sides){const n=i*(sides+1)+j;idx.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);}}}
 return geometry(pos,idx,uv,colors);
}
function taperedTube(points,r0,r1,segments=18,sides=10){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const g=new THREE.TubeGeometry(curve,segments,1,sides,false);const a=g.attributes.position;for(let i=0;i<=segments;i++){const c=curve.getPointAt(i/segments),r=r0+(r1-r0)*i/segments;for(let j=0;j<=sides;j++){const n=i*(sides+1)+j;a.setXYZ(n,c.x+(a.getX(n)-c.x)*r,c.y+(a.getY(n)-c.y)*r,c.z+(a.getZ(n)-c.z)*r);}}g.computeVertexNormals();return g;}
function plateGeometry(){return geometry([0,.22,-.47,-.43,0,-.09,-.36,.015,.35,0,.10,.60,.36,.015,.35,.43,0,-.09,0,.33,.05],[0,1,6,1,2,6,2,3,6,3,4,6,4,5,6,5,0,6,0,5,1,1,5,4,1,4,2,2,4,3],[.5,0,0,.32,.06,.83,.5,1,.94,.83,1,.32,.5,.5]);}
export function createDragon(renderer){
 const dragon=new THREE.Group();dragon.rotation.order='YXZ';
 const loader=new THREE.TextureLoader(),texture=loader.load('./dragon-scales.webp');texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const skin=new THREE.MeshStandardMaterial({color:0xb5ad98,map:texture,bumpMap:texture,bumpScale:.085,roughness:.73,metalness:.08,vertexColors:true});
 const limbSkin=skin.clone();limbSkin.vertexColors=false;limbSkin.color.set(0x9a947e);
 const armor=new THREE.MeshStandardMaterial({color:0xa6aaa2,map:texture,bumpMap:texture,bumpScale:.07,roughness:.57,metalness:.22});
 const ivory=new THREE.MeshStandardMaterial({color:0x8e8976,roughness:.62,metalness:.08});
 const boneMat=new THREE.MeshStandardMaterial({color:0x777565,map:texture,bumpMap:texture,bumpScale:.045,roughness:.7});
 const membrane=new THREE.MeshStandardMaterial({color:0x888276,side:THREE.DoubleSide,roughness:.86,metalness:.03,vertexColors:true});
 const flex={value:0};
 function flexShader(shader){shader.uniforms.uBend=flex;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uBend;\nmat3 bendMatrix(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.,-s,c,0.,0.,0.,1.);}')
 .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nfloat bendAngle=uBend*smoothstep(2.9,9.9,position.x);objectNormal=bendMatrix(bendAngle)*objectNormal;')
 .replace('#include <begin_vertex>','#include <begin_vertex>\nfloat bendPos=uBend*smoothstep(2.9,9.9,position.x);transformed=bendMatrix(bendPos)*(transformed-vec3(2.9,.38,-.9))+vec3(2.9,.38,-.9);');}
 const wingBone=boneMat.clone();wingBone.onBeforeCompile=flexShader;membrane.onBeforeCompile=flexShader;
 function mesh(parent,g,mat){const m=new THREE.Mesh(g,mat);parent.add(m);return m;}
 function tube(parent,points,r0,r1,mat=limbSkin){return mesh(parent,taperedTube(points,r0,r1),mat);}
 const body=mesh(dragon,loft([[-5.0,.10,.1,.35],[-4.6,.40,.24,.37],[-4.05,.70,.52,.48],[-3.45,.55,.57,.35],[-2.65,.43,.56,.14],[-1.6,.72,.70,.05],[-.65,1.15,.94,0],[.25,1.20,.9,-.06],[1.3,.9,.69,-.1],[2.3,.6,.48,-.12],[2.85,.44,.38,-.12]]),skin);
 const plate=plateGeometry();
 // Overlapping shield-shaped armor follows the spine instead of separate round bumps.
 for(let i=0;i<19;i++){const z=-3.2+i*.325,w=.62+.42*Math.exp(-Math.pow((z+.2)/1.8,2)),y=z< -1.6?.78:.84-Math.max(0,z-.5)*.12;const m=mesh(dragon,plate,armor);m.position.set(0,y,z);m.scale.set(w,.66,w*.78);if(i%2===0){tube(dragon,[[0,y+.05,z],[0,y+.45,z+.05],[0,y+.6,z+.3]],.12,.005,ivory);}}
 // Raised scale rows wrap around the shoulder and flank.
 for(const side of [-1,1]){for(let row=0;row<2;row++)for(let i=0;i<12;i++){const z=-1.7+i*.32,w=.72+.35*Math.exp(-Math.pow(z/1.8,2));const m=mesh(dragon,plate,armor);m.position.set(side*w*(.53+row*.27),.61-row*.25,z);m.rotation.z=-side*(.58+row*.28);m.scale.set(.34,.28,.34);}
  tube(dragon,[[side*.42,.7,-3.64],[side*.6,1.13,-3.13],[side*.72,1.22,-2.47],[side*.76,1.14,-2.13]],.19,.005,ivory);
  tube(dragon,[[side*.61,.43,-3.68],[side*.95,.58,-3.13],[side*1.06,.63,-2.76]],.14,.005,ivory);
  tube(dragon,[[side*.8,-.1,.9],[side*1.13,-.65,1.35],[side*1.3,-.93,2.1],[side*1.16,-1.11,2.8]],.47,.19);
  tube(dragon,[[side*1.16,-1.11,2.8],[side*1.2,-1.13,3.17]],.26,.2);
  for(let toe=0;toe<4;toe++){const x=side*(.91+toe*.17);tube(dragon,[[x,-1.08,2.87],[x,-1.24,3.29],[x,-1.13,3.58]],.09,.025);tube(dragon,[[x,-1.13,3.55],[x,-1.04,3.85]],.055,.001,ivory);}
  tube(dragon,[[side*.77,-.3,-1.24],[side*1.05,-.84,-.78],[side*.8,-1.05,.05]],.24,.085);
  const eye=mesh(dragon,new THREE.SphereGeometry(1,12,8),new THREE.MeshStandardMaterial({color:0xc9d28d,emissive:0x839737,emissiveIntensity:.85}));eye.position.set(side*.627,.61,-4.02);eye.scale.set(.065,.055,.13);
 }
 const tailRoot=new THREE.Group();tailRoot.position.set(0,-.12,2.53);dragon.add(tailRoot);
 const tailLength=8.3,tailRings=58,tailSides=18,tp=[],tu=[],ti=[],skinIndices=[],weights=[];
 for(let i=0;i<=tailRings;i++){const u=i/tailRings,r=.48*Math.pow(1-u,.82)+.015;for(let j=0;j<=tailSides;j++){const angle=j/tailSides*Math.PI*2;tp.push(Math.cos(angle)*r,Math.sin(angle)*r*.8,u*tailLength);tu.push(j/tailSides*1.1,u*3);const bone=u*8,low=Math.min(7,Math.floor(bone)),f=bone-low;skinIndices.push(low,low+1,0,0);weights.push(1-f,f,0,0);if(i<tailRings&&j<tailSides){const n=i*(tailSides+1)+j;ti.push(n,n+1,n+tailSides+1,n+1,n+tailSides+2,n+tailSides+1);}}}
 const tailGeo=geometry(tp,ti,tu);tailGeo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));tailGeo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));const tailMesh=new THREE.SkinnedMesh(tailGeo,limbSkin);const tailSegments=[];for(let i=0;i<9;i++){const b=new THREE.Bone();b.position.z=i?tailLength/8:0;if(i)tailSegments[i-1].add(b);tailSegments.push(b);}tailMesh.add(tailSegments[0]);tailMesh.bind(new THREE.Skeleton(tailSegments));tailRoot.add(tailMesh);
 for(let i=0;i<8;i++){const r=.48*Math.pow(1-i/8,.82),m=mesh(tailSegments[i],plate,armor);m.position.set(0,r*.75,0);m.scale.set((1-i/9)*.63,.5,.73);tube(tailSegments[i],[[0,r*.7,0],[0,r+.23,.2],[0,r+.28,.42]],.08*(1-i/10),.002,ivory);}
 const wings=[];
 for(const side of [-1,1]){const wing=new THREE.Group();wing.position.set(side*.82,.21,-1.2);wing.scale.x=side;dragon.add(wing);wings.push(wing);
  const wrist=[2.9,.38,-.9],tips=[[10,.1,-2.8],[7.9,-.13,.85],[5.5,-.19,2.95],[3.1,-.17,3.77],[.42,-.11,2.77]];
  tube(wing,[[0,0,0],[1.1,.37,-.05],wrist],.30,.18,wingBone);
  tube(wing,[wrist,[5.6,.43,-1.46],[8,.3,-2.13],tips[0]],.19,.012,wingBone);
  for(let k=1;k<tips.length;k++){const tip=tips[k];tube(wing,[wrist,[(wrist[0]+tip[0])*.5,.12,(wrist[2]+tip[2])*.5],tip],.095-k*.009,.012,wingBone);}
  const pos=[],idx=[],uv=[],col=[];
  for(let panel=0;panel<tips.length-1;panel++){const a=new THREE.Vector3(...tips[panel]),b=new THREE.Vector3(...tips[panel+1]),root=new THREE.Vector3(...wrist),mid=a.clone().add(b).multiplyScalar(.5).lerp(root,.24);const base=pos.length/3,nu=22,nv=14;
   for(let i=0;i<=nu;i++){const t=i/nu,edge=a.clone().multiplyScalar((1-t)**2).addScaledVector(mid,2*t*(1-t)).addScaledVector(b,t*t);for(let j=0;j<=nv;j++){const r=j/nv,v=root.clone().lerp(edge,r);v.y-=Math.sin(Math.PI*r)*Math.sin(Math.PI*t)*.21;pos.push(v.x,v.y,v.z);uv.push(v.x*.1,v.z*.2);const vein=Math.pow(Math.abs(Math.sin(t*Math.PI*18)),24)*.055,sag=Math.sin(Math.PI*r)*Math.sin(Math.PI*t);col.push(.64+sag*.24-vein,.61+sag*.20-vein,.56+sag*.14-vein);if(i<nu&&j<nv){const n=base+i*(nv+1)+j;idx.push(n,n+1,n+nv+1,n+1,n+nv+2,n+nv+1);}}}
   tube(wing,[tips[panel],mid.toArray(),tips[panel+1]],.018,.014,wingBone);
  }
  mesh(wing,geometry(pos,idx,uv,col),membrane);
  // A rounded leading-edge arm and a hooked thumb give the wing its bat-like anatomy.
  tube(wing,[wrist,[2.95,.74,-1.02],[3.1,.83,-1.42]],.14,.004,ivory);
  mergeRigid(wing);
 }
 mergeRigid(dragon);dragon.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;}});
 // Apply the same wing deformation in the shadow pass.
 for(const w of wings)w.traverse(m=>{if(m.isMesh){m.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});m.customDepthMaterial.onBeforeCompile=flexShader;}});
 function update(pose,flight,l,r,time){flex.value=pose.tip;for(let i=0;i<2;i++){const side=i===0?-1:1;wings[i].rotation.z=side*(pose.sweep+(i? r:l)*.09);wings[i].rotation.y=-side*pose.fold;}
  for(let i=0;i<tailSegments.length;i++){tailSegments[i].rotation.y=Math.sin(time*1.25-i*.36)*.024-flight.roll*.014;tailSegments[i].rotation.x=.019+Math.sin(time*1.5-i*.25)*.015;}}
 function wingTip(i,pose){const angle=pose.tip,x=10-2.9,y=.1-.38;const p=new THREE.Vector3(Math.cos(angle)*x-Math.sin(angle)*y+2.9,Math.sin(angle)*x+Math.cos(angle)*y+.38,-2.8);return wings[i].localToWorld(p);}
 return {dragon,wings,tailSegments,update,wingTip};
}
