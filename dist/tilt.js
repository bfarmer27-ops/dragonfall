const rad=Math.PI/180;
export function screenTilt(beta,gamma,angle=0){
 const b=beta*rad,g=gamma*rad,a=angle*rad;
 const x=Math.cos(b)*Math.sin(g),y=Math.sin(b),z=Math.cos(b)*Math.cos(g);
 return {pitch:Math.atan2(y*Math.cos(a)-x*Math.sin(a),z)/rad,bank:Math.asin(Math.max(-1,Math.min(1,x*Math.cos(a)+y*Math.sin(a))))/rad};
}
const delta=(a,b)=>((a-b+540)%360)-180;
const axis=v=>Math.sign(v)*Math.min(1,Math.max(0,Math.abs(v)-2)/23);
export function tiltCommands(current,neutral){return {pitch:axis(delta(current.pitch,neutral.pitch)),bank:-axis(delta(current.bank,neutral.bank))};}
export function createTilt(){
 let latest=null,neutral=null,stamp=0,authorized=false;
 const angle=()=>globalThis.screen?.orientation?.angle??globalThis.orientation??0;
 globalThis.addEventListener('deviceorientation',e=>{if(!Number.isFinite(e.beta)||!Number.isFinite(e.gamma))return;latest=screenTilt(e.beta,e.gamma,angle());stamp=performance.now();if(!neutral)neutral=latest;});
 return {
  async enable(){
   if(!globalThis.DeviceOrientationEvent)throw Error('Tilt is unavailable on this device. Select Two thumbs in Settings.');
   if(!authorized&&typeof DeviceOrientationEvent.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission()!=='granted')throw Error('Motion permission was denied. Allow motion in your browser or select Two thumbs.');
   authorized=true;
   const started=performance.now();
   while(!latest||performance.now()-stamp>500){if(performance.now()-started>2500)throw Error('No motion data received. Allow motion access or select Two thumbs.');await new Promise(r=>setTimeout(r,50));}
   neutral=latest;
  },
  calibrate(){neutral=latest&&performance.now()-stamp<500?latest:null;},
  rotate(){latest=null;neutral=null;},
  read(){return latest&&neutral&&performance.now()-stamp<1000?tiltCommands(latest,neutral):{pitch:0,bank:0};}
 };
}
