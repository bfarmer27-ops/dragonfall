// Voice trigger for the fireball: say the fire word (default "dracarys", changeable in Settings) and the dragon breathes fire.
// Uses the browser's SpeechRecognition (Chrome on Android and desktop; Safari on iOS 14.5+). Listening restarts itself
// whenever the browser stops it. If the browser has no speech support, supported = false and the Fire button is the fallback.
export const DEFAULT_FIRE_WORD='dracarys';
// Statuses the browser will not recover from on its own: the microphone was denied, the speech service is blocked,
// or there is no microphone. Chrome fires onerror(<one of these>) and then onend; onend must NOT reset them to
// 'idle', or the Settings line would read 'starts listening when you take flight' about a microphone it never gets.
// Only stop() (the user switching Voice fire off) clears them, so the next take-off asks the browser again.
export const STICKY_STATUSES=['not-allowed','service-not-allowed','audio-capture'];
export function readFireWord(){try{return (localStorage.getItem('dragonfall-fire-word')||DEFAULT_FIRE_WORD).trim()||DEFAULT_FIRE_WORD;}catch{return DEFAULT_FIRE_WORD;}}
export function saveFireWord(word){const w=(word||'').trim()||DEFAULT_FIRE_WORD;try{localStorage.setItem('dragonfall-fire-word',w);}catch{}return w;}
export const normalize=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
// Edit distance so "dracarus", "drakaris" or "the crisis" still count as the fire word.
function editDistance(a,b){const m=a.length,n=b.length,d=new Array(n+1);for(let j=0;j<=n;j++)d[j]=j;for(let i=1;i<=m;i++){let prev=d[0];d[0]=i;for(let j=1;j<=n;j++){const tmp=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=tmp;}}return d[n];}
export function matchesFireWord(transcript,word){
 const t=normalize(transcript),w=normalize(word);if(!t||!w)return false;
 if(t.includes(w))return true;
 // Short words get no slack (so 'tire' never fires 'fire'); long words like 'dracarys' allow 2 wrong letters.
 const tolerance=w.length>=8?2:w.length>=6?1:0;
 const target=w.replace(/ /g,'');const tokens=t.split(' ');
 // Compare single tokens and joined neighbouring pairs against the word with spaces removed.
 for(let i=0;i<tokens.length;i++){if(editDistance(tokens[i],target)<=tolerance)return true;if(i+1<tokens.length&&editDistance(tokens[i]+tokens[i+1],target)<=tolerance)return true;}
 return false;
}
export function createSpeech({onFire,getWord=readFireWord,onStatus=()=>{}}={}){
 const SR=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
 const state={supported:!!SR,listening:false,status:SR?'idle':'unsupported',lastHeard:''};
 if(!SR)return {state,start(){},stop(){}};
 let rec=null,wantActive=false,cooldownUntil=0,restartTimer=0,restartDelay=300;
 function build(){
  rec=new SR();rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=3;rec.lang=navigator.language||'en-US';
  rec.onstart=()=>{state.listening=true;state.status='listening';restartDelay=300;onStatus(state);};
  rec.onresult=e=>{
   for(let i=e.resultIndex;i<e.results.length;i++){const alts=e.results[i];for(let j=0;j<alts.length;j++){const text=alts[j].transcript;state.lastHeard=text;
    if(performance.now()>cooldownUntil&&matchesFireWord(text,getWord())){cooldownUntil=performance.now()+1200;onFire(text);
     // Restart so the same phrase in a long interim result does not fire twice.
     try{rec.abort();}catch{}return;}}}
   onStatus(state);
  };
  // 'audio-capture' = no microphone on this device, so restarting is pointless; other errors back off 300 ms -> 5 s.
  rec.onerror=e=>{state.status=e.error;if(STICKY_STATUSES.includes(e.error)){wantActive=false;state.listening=false;}else restartDelay=Math.min(5000,restartDelay*2);onStatus(state);};
  // onend follows every stop, including the one right after a sticky error: keep that error on show, reset only a
  // transient status ('listening', 'no-speech', 'aborted', 'network') to 'idle'.
  rec.onend=()=>{state.listening=false;if(wantActive){clearTimeout(restartTimer);restartTimer=setTimeout(()=>{try{rec.start();}catch{}},restartDelay);}else{if(!STICKY_STATUSES.includes(state.status))state.status='idle';onStatus(state);}};
 }
 return {
  state,
  // 'starting' until the browser answers with onstart (listening) or onerror (denied / no microphone / no service).
  start(){wantActive=true;if(!rec)build();state.status='starting';onStatus(state);try{rec.start();}catch{}},
  stop(){wantActive=false;clearTimeout(restartTimer);try{rec?.stop();}catch{}state.listening=false;state.status='idle';onStatus(state);},
 };
}
