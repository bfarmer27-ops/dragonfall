export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
export const FLIGHT_SPEED_MULTIPLIER=1.75;
export const VERTICAL_SPEED_MULTIPLIER=2;
export const TURN_STRENGTH_MULTIPLIER=1.5;
export const PHYSICS_STEP=1/120;
export function wingCommand(left,right){return {pitch:clamp((left+right)*.5,-1,1),bank:clamp((right-left)*.5,-1,1)}}
export function centerAt(d){return 28*Math.sin(d*.0027)+15*Math.sin(d*.0061)}
export function newFlight(){return {distance:0,x:centerAt(0),alt:29,speed:35*FLIGHT_SPEED_MULTIPLIER,pitch:0,roll:0,yaw:0,vx:0,vy:-.5*VERTICAL_SPEED_MULTIPLIER,gates:0,health:3,invulnerable:0,elapsed:0}}
export function stepFlight(f,left,right,dt){
 const command=wingCommand(left,right);
 f.pitch=damp(f.pitch,command.pitch*.34,3.3,dt);
 f.roll=damp(f.roll,command.bank*.97,16,dt);
 // Scale lateral steering per forward meter, with direct input response.
 // Heading no longer waits for the bank animation to catch up first.
 const targetYaw=Math.atan(TURN_STRENGTH_MULTIPLIER*Math.tan(command.bank*.83*.64));
 f.yaw=damp(f.yaw,targetYaw,12,dt);
 f.speed=damp(f.speed,clamp(37+f.elapsed*.055-command.pitch*14,22,69)*FLIGHT_SPEED_MULTIPLIER,.65,dt);
 f.vx=damp(f.vx,-Math.sin(f.yaw)*f.speed,14,dt);
 f.vy=damp(f.vy,(command.pitch*16-.65)*VERTICAL_SPEED_MULTIPLIER,2.4,dt);
 f.distance+=f.speed*Math.cos(f.yaw)*dt;
 f.x+=f.vx*dt;
 f.alt=clamp(f.alt+f.vy*dt,-1,88);
 f.elapsed+=dt;f.invulnerable=Math.max(0,f.invulnerable-dt);
 return f;
}
