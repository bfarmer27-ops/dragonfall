// Multiplayer over WebRTC using PeerJS (dist/vendor/peerjs.min.js, loaded by index.html as window.Peer).
// One player HOSTS and gets a 4-letter room code; friends JOIN with that code. Every joiner connects to the host and the
// host relays every packet to everyone else (star shape), so all riders see each other in the same canyon.
// Packets: {t:'hello',id,name}  {t:'s',id,x,a,d,p,r,y,ph,h,n} (state)  {t:'e',id,k,...} (event: fire, hit, respawn)  {t:'bye',id}
const ALPHABET='BCDFGHJKLMNPQRSTVWXZ';
export const roomCode=()=>Array.from({length:4},()=>ALPHABET[Math.floor(Math.random()*ALPHABET.length)]).join('');
export const peerIdFor=code=>'dragonfall-'+String(code||'').toUpperCase().replace(/[^A-Z]/g,'');
export function readName(){try{return localStorage.getItem('dragonfall-name')||'';}catch{return '';}}
export function saveName(n){try{localStorage.setItem('dragonfall-name',n);}catch{}return n;}
export function createNet({onStatus=()=>{},onPlayer=()=>{},onEvent=()=>{}}={}){
 const players=new Map(); // id -> {name, state, seen}
 let peer=null,hostConn=null,isHost=false,code='',myId='',name=readName()||('Rider-'+roomCode().slice(0,2)),sendTimer=0;
 const conns=new Map(); // host side: peer id -> DataConnection
 const status={mode:'offline',code:'',error:'',count:0};
 const report=(patch)=>{Object.assign(status,patch);status.count=players.size;onStatus(status);};
 function ensurePeerLib(){if(!globalThis.Peer)throw Error('Multiplayer library did not load. Reload the page.');}
 function handle(packet,from){
  if(!packet||!packet.id||packet.id===myId)return;
  if(isHost)for(const [id,c] of conns)if(id!==from&&c.open)c.send(packet); // relay to everyone else
  if(packet.t==='bye'){players.delete(packet.id);onPlayer('leave',packet.id);report({});return;}
  let p=players.get(packet.id);
  if(!p){p={name:packet.name||packet.n||'Rider',state:null,seen:performance.now()};players.set(packet.id,p);onPlayer('join',packet.id,p);report({});}
  p.seen=performance.now();
  if(packet.t==='s'){p.state=packet;if(packet.n)p.name=packet.n;}
  else if(packet.t==='e')onEvent(packet);
 }
 function wire(conn){
  conn.on('open',()=>{conns.set(conn.peer,conn);conn.send({t:'hello',id:myId,name});report({});});
  conn.on('data',d=>handle(d,conn.peer));
  conn.on('close',()=>{conns.delete(conn.peer);handle({t:'bye',id:conn.peer},conn.peer);});
  conn.on('error',e=>report({error:String(e?.message||e)}));
 }
 function send(packet){
  if(isHost){for(const c of conns.values())if(c.open)c.send(packet);}
  else if(hostConn?.open)hostConn.send(packet);
 }
 const api={
  status,players,
  get id(){return myId;},get name(){return name;},
  setName(n){name=saveName((n||'').trim().slice(0,14)||name);},
  async host(){
   ensurePeerLib();api.leave();code=roomCode();isHost=true;
   peer=new Peer(peerIdFor(code),{debug:0});
   await new Promise((resolve,reject)=>{peer.on('open',id=>{myId=id;resolve();});peer.on('error',e=>{report({error:String(e?.type||e)});reject(e);});});
   peer.on('connection',wire);report({mode:'host',code,error:''});return code;
  },
  async join(roomCodeText){
   ensurePeerLib();api.leave();code=String(roomCodeText||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);isHost=false;
   peer=new Peer({debug:0});
   await new Promise((resolve,reject)=>{peer.on('open',id=>{myId=id;resolve();});peer.on('error',e=>{report({error:String(e?.type||e)});reject(e);});});
   hostConn=peer.connect(peerIdFor(code),{reliable:true});
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No room "'+code+'" answered. Check the code and that the host is online.')),8000);hostConn.on('open',()=>{clearTimeout(timer);resolve();});peer.on('error',e=>{clearTimeout(timer);reject(Error('Could not reach room '+code+' ('+(e?.type||e)+').'));});});
   hostConn.on('data',d=>handle(d,'host'));hostConn.on('close',()=>{report({mode:'offline',error:'The host left.'});api.leave();});
   hostConn.send({t:'hello',id:myId,name});report({mode:'guest',code,error:''});return code;
  },
  leave(){
   try{send({t:'bye',id:myId});}catch{}
   for(const c of conns.values())try{c.close();}catch{}conns.clear();
   try{hostConn?.close();}catch{}hostConn=null;try{peer?.destroy();}catch{}peer=null;
   players.clear();isHost=false;code='';report({mode:'offline',code:''});
  },
  // Call every frame; sends the local state at ~12 Hz and drops riders silent for 6 s.
  update(flight,phase,dt){
   if(status.mode==='offline')return;
   sendTimer+=dt;if(sendTimer>=1/12){sendTimer=0;send({t:'s',id:myId,n:name,x:+flight.x.toFixed(2),a:+flight.alt.toFixed(2),d:+flight.distance.toFixed(1),p:+flight.pitch.toFixed(3),r:+flight.roll.toFixed(3),y:+flight.yaw.toFixed(3),ph:+((phase||0)%6.2832).toFixed(2),h:flight.health});}
   const t=performance.now();for(const [id,p] of players)if(t-p.seen>6000){players.delete(id);onPlayer('leave',id);report({});}
  },
  event(kind,data){send({t:'e',id:myId,k:kind,...data});},
  shareLink(){const u=new URL(location.href);u.search='?room='+code;return u.toString();},
 };
 return api;
}
