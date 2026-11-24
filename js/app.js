// Строймозг — основное приложение.
{
const TYPES={
 object:{n:'Объект',c:'#d1453b',f:['Адрес','Заказчик','Стадия','Бюджет, ₽'],tpl:'## Описание\n\n## Состав работ\n- \n\n## Открытые вопросы\n- [ ] '},
 contract:{n:'Контракт',c:'#2463c9',f:['Номер','Дата','Сумма, ₽','Срок окончания'],tpl:'## Предмет\n\n## Допсоглашения\n- '},
 estimate:{n:'Смета / ССР',c:'#0f8b8d',f:['Версия','Сумма, ₽','Источник','Дата'],tpl:'## Что изменилось\n- '},
 decision:{n:'Решение',c:'#d98a00',f:['Дата','Кто принял','Документ'],tpl:'## Суть решения\n\n## На что повлияло\n- '},
 norm:{n:'Норматив',c:'#6a55c9',f:['Шифр','Действует с','Ссылка'],tpl:'## Ключевые положения\n- \n\n## Где применял\n- '},
 party:{n:'Организация',c:'#8a6a44',f:['Роль','ИНН','Адрес','Телефон'],tpl:'## Заметки\n'},
 person:{n:'Контакт',c:'#7c9a2a',f:['Должность','Организация','Телефон','Email','Мессенджер'],tpl:'## Заметки\n'},
 doc:{n:'Документ',c:'#4b6584',f:['Номер','Дата','От кого','Кому'],tpl:'## Содержание\n'},
 task:{n:'Задача',c:'#c23a85',f:['Статус','Срок','Ответственный'],tpl:'- [ ] '},
 note:{n:'Заметка',c:'#7a828c',f:[],tpl:''}
};
const RELS=['относится к','входит в','основание','заменяет','противоречит','исполнитель','контакт по','работает в'];
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unesc=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const escRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const LINK=/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const uid=()=>'n'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmt=t=>t?new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const fmtD=t=>new Date(t).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
const fmtN=v=>v==null||!isFinite(v)?'—':Number(v).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2});
const sgn=v=>v>0.005?'+'+fmtN(v):fmtN(v);
const cls=v=>v>0.005?'neg':v<-0.005?'pos':'';
const pct=(d,a)=>a?((d/a*100>0?'+':'')+(d/a*100).toFixed(1).replace('.',',')+' %'):'';
const name=n=>n.title.trim()||'Без названия';
const dot=t=>'<span class="dot" style="background:'+TYPES[t].c+'"></span>';

let notes=new Map(),byTitle=new Map(),backs=new Map(),adj=new Map(),edges=[];
let remote={},unsynced=new Set(),trashQ=[],pulling=false,pushing=false,lastSync=0,driveErr='';
const dirty=new Map();
const S={cur:null,view:'list',type:null,q:'',edit:false,gFocus:null,gDepth:1,cq:'',cproj:'',cmp:{},oldTitle:null};

/* ================= данные ================= */
const numOrNull=v=>typeof v==='number'&&isFinite(v)?v:null;
function cleanEst(e){
 if(!e||typeof e!=='object'||!Array.isArray(e.chapters))return null;
 return{file:String(e.file||''),sheet:String(e.sheet||''),imported:+e.imported||0,grand:numOrNull(e.grand),vat:numOrNull(e.vat),driveLink:/^https:\/\//.test(e.driveLink||'')?String(e.driveLink):'',
  chapters:e.chapters.filter(c=>c&&typeof c==='object').map(c=>({n:+c.n||0,name:String(c.name||''),total:+c.total||0,items:Array.isArray(c.items)?c.items.filter(i=>i&&typeof i==='object').map(i=>({name:String(i.name||''),total:+i.total||0})):[]})),
  subtotals:Array.isArray(e.subtotals)?e.subtotals.filter(s=>s&&typeof s==='object').map(s=>({label:String(s.label||''),total:+s.total||0})):[]};
}
function clean(id,d){
 if(!d||typeof d!=='object')return null;
 const f={};if(d.fields&&typeof d.fields==='object')for(const k in d.fields)f[String(k)]=String(d.fields[k]??'');
 const rels=Array.isArray(d.rels)?d.rels.filter(r=>r&&typeof r==='object').map(r=>({r:String(r.r||RELS[0]),t:String(r.t||'')})):[];
 const n={id:String(id),title:String(d.title||''),type:TYPES[d.type]?d.type:'note',fields:f,body:String(d.body||''),rels,created:+d.created||Date.now(),updated:+d.updated||Date.now()};
 const e=cleanEst(d.est);if(e)n.est=e;
 return n;
}
const KEYS=['id','title','type','fields','rels','created','updated','est'];
function toMd(n){return '---\n'+KEYS.filter(k=>n[k]!==undefined&&n[k]!==null).map(k=>k+': '+JSON.stringify(n[k])).join('\n')+'\n---\n'+n.body}
function fromMd(txt,id,fname){
 const m=String(txt).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/),d={};
 if(m){for(const ln of m[1].split(/\r?\n/)){const k=ln.match(/^(\w+):\s?(.*)$/);if(k){try{d[k[1]]=JSON.parse(k[2])}catch(e){d[k[1]]=k[2]}}}d.body=txt.slice(m[0].length)}
 else{d.body=String(txt);d.title=String(fname||'').replace(/\.md$/i,'')}
 return clean(d.id||id||uid(),d);
}
const fname=n=>(name(n).replace(/[\\/:*?"<>|#^[\]]/g,'_').slice(0,120))+'.md';

/* ================= кэш и синхронизация ================= */
function saveCache(){
 try{localStorage.setItem('sm-notes',JSON.stringify([...notes.values()]));localStorage.setItem('sm-remote',JSON.stringify(remote));localStorage.setItem('sm-queue',JSON.stringify({u:[...unsynced],t:trashQ}))}
 catch(e){toast('Память браузера заполнена — подключите Google Диск или сделайте экспорт')}
}
function loadCache(){
 try{for(const d of JSON.parse(localStorage.getItem('sm-notes')||'[]')){const n=clean(d.id,d);if(n)notes.set(n.id,n)}}catch(e){}
 try{remote=JSON.parse(localStorage.getItem('sm-remote')||'{}')||{}}catch(e){remote={}}
 try{const q=JSON.parse(localStorage.getItem('sm-queue')||'{}');unsynced=new Set(q.u||[]);trashQ=q.t||[]}catch(e){}
}
const inEditor=()=>document.activeElement&&$('#nview').contains(document.activeElement)&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
function touch(n){
 n.updated=Date.now();clearTimeout(dirty.get(n.id));
 dirty.set(n.id,setTimeout(()=>flush(n.id),800));lazyList();status();
}
function flush(id){
 if(!dirty.has(id))return;clearTimeout(dirty.get(id));dirty.delete(id);
 if(!notes.has(id))return;
 unsynced.add(id);saveCache();reindex();pushAll();status();
}
const flushAll=()=>{for(const id of [...dirty.keys()])flush(id)};
function remove(id){
 clearTimeout(dirty.get(id));dirty.delete(id);notes.delete(id);unsynced.delete(id);
 if(remote[id]){trashQ.push(remote[id].fid);delete remote[id]}
 saveCache();pushAll();
}
function driveFail(e){
 if(e&&e.code==='auth')driveErr='auth';else driveErr=(e&&e.message)||'ошибка связи';
 status();
}
async function pushAll(){
 if(pushing||!SMDrive.connected())return;pushing=true;status();
 try{
  while(trashQ.length){await SMDrive.trash(trashQ[0]);trashQ.shift();saveCache()}
  for(const id of [...unsynced]){
   const n=notes.get(id);if(!n){unsynced.delete(id);continue}
   if(dirty.has(id))continue;
   const ver=n.updated,r=remote[id];
   const res=await SMDrive.saveNote({fileId:r&&r.fid,name:fname(n),smid:id,text:toMd(n)});
   remote[id]={fid:res.id,mt:res.modifiedTime};
   const now=notes.get(id);if(now&&now.updated===ver&&!dirty.has(id))unsynced.delete(id);
   saveCache();
  }
  driveErr='';lastSync=Date.now();
 }catch(e){driveFail(e)}
 finally{pushing=false;status()}
 if(!driveErr&&[...unsynced].some(id=>!dirty.has(id)))setTimeout(pushAll,300);
}
async function pool(items,k,fn){let i=0;await Promise.all(Array.from({length:Math.min(k,items.length)},async()=>{while(i<items.length)await fn(items[i++])}))}
async function pull(){
 if(pulling||!SMDrive.connected())return;pulling=true;status();
 let changed=false;const before=S.cur&&notes.get(S.cur),bj=before&&JSON.stringify(before);
 try{
  const files=await SMDrive.listNotes(),seen=new Set(),todo=[];
  for(const f of files){
   const id=f.appProperties&&f.appProperties.smid;
   if(id){seen.add(id);if(dirty.has(id)||unsynced.has(id))continue;const r=remote[id];if(r&&r.fid===f.id&&r.mt===f.modifiedTime&&notes.has(id))continue}
   todo.push({f,id});
  }
  await pool(todo,6,async({f,id})=>{
   const n=fromMd(await SMDrive.download(f.id),id,f.name);if(!n)return;seen.add(n.id);
   if(dirty.has(n.id)||unsynced.has(n.id))return;
   notes.set(n.id,n);remote[n.id]={fid:f.id,mt:f.modifiedTime};changed=true;
  });
  for(const id of Object.keys(remote))if(!seen.has(id)&&!unsynced.has(id)&&!dirty.has(id)){delete remote[id];if(notes.delete(id))changed=true}
  for(const id of notes.keys())if(!remote[id])unsynced.add(id);
  saveCache();driveErr='';lastSync=Date.now();
 }catch(e){driveFail(e)}
 finally{pulling=false}
 if(changed){
  if(S.cur&&!notes.has(S.cur)){S.cur=null;refresh();if(S.view==='note')go('list')}
  else{const now=S.cur&&notes.get(S.cur);refresh(now&&!inEditor()&&JSON.stringify(now)!==bj)}
 }
 status();pushAll();
}
async function connect(){
 try{await SMDrive.signIn();driveErr='';toast('Google Диск подключён');await pull()}
 catch(e){driveErr=e.message;status();toast(e.message)}
}
function status(){
 const el=$('#sync'),row=$('#driveRow'),wait=unsynced.size+dirty.size;
 let t,b='';
 if(!SMDrive.configured()){t='Данные хранятся <b>в этом браузере</b>. Google Диск не настроен — см. README.'}
 else if(driveErr==='auth'||!SMDrive.connected()){t=(driveErr==='auth'?'Сессия Google истекла. ':'')+'Данные в этом браузере'+(wait?', ждут отправки: '+wait:'')+'.';b='<button class="btn sm pri" id="dConn">Подключить Google Диск</button>'}
 else{
  t='<b>Google Диск</b> · '+(pulling?'загрузка…':pushing||dirty.size?'сохранение…':driveErr?'ошибка: '+esc(driveErr):wait?'ждут отправки: '+wait:'синхронизировано'+(lastSync?' в '+new Date(lastSync).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''));
  const fl=SMDrive.folderLink();
  b=(fl?'<a class="btn sm" href="'+esc(fl)+'" target="_blank" rel="noopener">Папка на Диске</a>':'')+'<button class="btn sm" id="dSync">Обновить</button><button class="btn sm" id="dOut">Выйти</button>';
 }
 el.innerHTML=t+' · карточек: '+notes.size;row.innerHTML=b;
}
$('#driveRow').addEventListener('click',e=>{
 const id=e.target.id;
 if(id==='dConn')connect();
 if(id==='dSync')pull();
 if(id==='dOut'){SMDrive.signOut();status();toast('Вы вышли из Google. Данные остались в браузере.')}
});

/* ================= индекс связей ================= */
function linksOf(n){
 const out=[],txt=[n.body,...Object.values(n.fields)].join('\n');
 for(const m of txt.matchAll(LINK))out.push({t:m[1].trim(),r:'ссылка'});
 for(const r of n.rels)if(r.t.trim())out.push({t:r.t.replace(/^\[\[|\]\]$/g,'').trim(),r:r.r});
 return out;
}
function reindex(){
 byTitle=new Map();for(const n of notes.values())if(n.title.trim())byTitle.set(n.title.trim().toLowerCase(),n.id);
 backs=new Map();adj=new Map();edges=[];const seen=new Set();
 const add=(a,b)=>{if(!adj.has(a))adj.set(a,new Set());adj.get(a).add(b)};
 for(const n of notes.values())for(const l of linksOf(n)){
  const to=byTitle.get(l.t.toLowerCase());if(!to||to===n.id)continue;
  if(!backs.has(to))backs.set(to,[]);backs.get(to).push({from:n.id,r:l.r});
  add(n.id,to);add(to,n.id);
  const k=n.id<to?n.id+'|'+to:to+'|'+n.id;if(!seen.has(k)){seen.add(k);edges.push({a:n.id,b:to,r:l.r})}
 }
 $('#titles').innerHTML=[...notes.values()].map(n=>'<option value="'+esc(n.title)+'">').join('');
}
function near(id,depth){
 const keep=new Set([id]);let fr=[id];
 for(let d=0;d<depth;d++){const nx=[];for(const x of fr)for(const y of adj.get(x)||[])if(!keep.has(y)){keep.add(y);nx.push(y)}fr=nx}
 return keep;
}
function refresh(redrawNote){
 reindex();renderChips();renderList();status();
 if(S.view==='graph')buildGraph();
 else if(S.view==='contacts')renderContacts();
 else if(redrawNote||!S.cur)renderNote();
}

/* ================= список ================= */
function renderChips(){
 const cnt={};for(const n of notes.values())cnt[n.type]=(cnt[n.type]||0)+1;
 $('#chips').innerHTML='<button class="chip'+(S.type?'':' on')+'" data-t="">Все '+notes.size+'</button>'+
  Object.entries(TYPES).filter(([k])=>cnt[k]).map(([k,t])=>'<button class="chip'+(S.type===k?' on':'')+'" data-t="'+k+'">'+dot(k)+t.n+' '+cnt[k]+'</button>').join('');
}
function filtered(){
 const q=S.q.toLowerCase();
 return [...notes.values()].filter(n=>(!S.type||n.type===S.type)&&(!q||(n.title+' '+n.body+' '+Object.values(n.fields).join(' ')).toLowerCase().includes(q))).sort((a,b)=>b.updated-a.updated);
}
const strip=s=>s.replace(LINK,(m,x,y)=>y||x);
function renderList(){
 const a=filtered();
 $('#list').innerHTML=a.length?a.map(n=>{const sub=[TYPES[n.type].n,...Object.values(n.fields).filter(Boolean).slice(0,2)].join(' · ');
  return '<button class="it'+(n.id===S.cur?' cur':'')+'" data-id="'+esc(n.id)+'">'+dot(n.type)+'<b>'+esc(name(n))+'</b><small>'+esc(strip(sub))+'</small></button>'}).join('')
  :'<p class="empty" style="padding:14px">'+(notes.size?'Ничего не найдено.':'Карточек пока нет.')+'</p>';
}
let lt=0;const lazyList=()=>{clearTimeout(lt);lt=setTimeout(()=>{reindex();renderChips();renderList()},300)};

/* ================= разметка текста ================= */
function inline(s){
 return esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<i>$2</i>')
  .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,(m,t,al)=>'<a class="wl'+(byTitle.has(unesc(t).trim().toLowerCase())?'':' miss')+'" data-t="'+t.trim()+'">'+(al||t)+'</a>')
  .replace(/(^|\s)(https:\/\/[^\s<]+)/g,'$1<a class="ext" href="$2" target="_blank" rel="noopener">$2</a>');
}
function md(src){
 const L=src.split('\n');let h='',ul=false;
 const close=()=>{if(ul){h+='</ul>';ul=false}};
 L.forEach((ln,i)=>{
  let m;
  if((m=ln.match(/^(#{1,3})\s+(.*)/))){close();h+='<h'+m[1].length+'>'+inline(m[2])+'</h'+m[1].length+'>'}
  else if((m=ln.match(/^\s*[-*]\s+\[( |x|х)\]\s?(.*)/i))){if(!ul){h+='<ul>';ul=true}h+='<li class="ck"><label><input type="checkbox" data-ln="'+i+'"'+(m[1]===' '?'':' checked')+'> '+inline(m[2])+'</label></li>'}
  else if((m=ln.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/))){if(!ul){h+='<ul>';ul=true}h+='<li>'+inline(m[1])+'</li>'}
  else if(!ln.trim())close();
  else{close();h+='<p>'+inline(ln)+'</p>'}
 });close();return h||'<p class="empty">Текста нет. Нажмите «Править».</p>';
}

/* ================= хронология ================= */
function dateOf(n){
 for(const k of Object.keys(n.fields))if(/^дата/i.test(k)){const m=String(n.fields[k]).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);if(m)return{t:new Date(+m[3],+m[2]-1,+m[1]).getTime(),src:k.toLowerCase()}}
 return{t:n.created,src:'создана'};
}
function timeline(n){
 const ids=[...near(n.id,n.type==='object'?2:1)].map(id=>notes.get(id)).filter(o=>o&&o.type!=='person'&&o.type!=='party'&&o.type!=='norm');
 if(ids.length<2)return '<p class="empty">Пока нечего показать: свяжите карточки с датами (письма, решения, версии смет).</p>';
 const a=ids.map(o=>({o,d:dateOf(o)})).sort((x,y)=>x.d.t-y.d.t);
 return '<ol class="tl">'+a.map(({o,d})=>'<li style="--c:'+TYPES[o.type].c+'"><time>'+fmtD(d.t)+' <small>'+esc(d.src)+'</small></time>'+
  (o.id===n.id?'<b>'+esc(name(o))+'</b>':'<button data-open="'+esc(o.id)+'">'+esc(name(o))+'</button>')+' <em>'+TYPES[o.type].n+(o.est&&o.est.grand!=null?' · '+fmtN(o.est.grand):'')+'</em></li>').join('')+'</ol>';
}

/* ================= ССР ================= */
function estSection(n){
 const e=n.est;
 let h='<h2 class="sec">Данные ССР <small>'+(e?esc(e.file)+' · лист «'+esc(e.sheet)+'» · загружено '+fmt(e.imported):'не загружены')+'</small><button class="btn sm" id="estLoad">'+(e?'Заменить из Excel':'Загрузить из Excel')+'</button></h2><input type="file" id="estFile" class="hidden" accept=".xlsx,.xls,.xlsm">';
 if(!e)return h+'<p class="empty">Загрузите xlsx или xls сводного сметного расчёта (выгрузка из Гранд-Сметы или своя форма). Приложение найдёт главы, итоги и сможет сравнивать версии.</p>';
 h+='<div class="estbar"><span>Всего по ССР: <span class="big">'+fmtN(e.grand)+'</span></span>'+(e.vat!=null?'<span class="sub">в т.ч. НДС '+fmtN(e.vat)+'</span>':'')+
  (e.driveLink?'<a class="btn sm" href="'+esc(e.driveLink)+'" target="_blank" rel="noopener">Исходный файл</a>':'')+'</div>';
 h+='<div class="scroll"><table class="t"><thead><tr><th>Гл.</th><th>Наименование</th><th class="n">Сумма</th></tr></thead><tbody>'+
  e.chapters.map(c=>'<tr><td class="n">'+c.n+'</td><td><details class="ch"><summary>'+esc(c.name)+'</summary><div class="sub">'+(c.items.length?c.items.map(i=>esc(i.name)+' — '+fmtN(i.total)).join('<br>'):'строк нет')+'</div></details></td><td class="n">'+fmtN(c.total)+'</td></tr>').join('')+
  e.subtotals.map(s=>'<tr><td></td><td class="sub">'+esc(s.label)+'</td><td class="n sub">'+fmtN(s.total)+'</td></tr>').join('')+
  '<tr class="tot"><td></td><td>Всего по ССР</td><td class="n">'+fmtN(e.grand)+'</td></tr></tbody></table></div><p class="sub">Суммы — в единицах файла (обычно тыс. руб.).</p>';
 const others=[...notes.values()].filter(o=>o.id!==n.id&&o.type==='estimate'&&o.est);
 if(!others.length)return h+'<p class="empty">Для сравнения загрузите ССР в другую карточку сметы (например, предыдущую версию).</p>';
 if(S.cmp[n.id]===undefined){const rep=n.rels.find(r=>r.r==='заменяет'&&byTitle.get(r.t.trim().toLowerCase()));const rid=rep&&byTitle.get(rep.t.trim().toLowerCase());S.cmp[n.id]=rid&&notes.get(rid)&&notes.get(rid).est?rid:''}
 const oid=S.cmp[n.id],o=oid&&notes.get(oid);
 h+='<h2 class="sec">Сравнение версий</h2><div class="estbar"><label for="cmpSel">Сравнить с</label><select id="cmpSel"><option value="">— выберите смету —</option>'+others.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===oid?' selected':'')+'>'+esc(name(x))+'</option>').join('')+'</select></div>';
 if(!o||!o.est)return h;
 const c=SMEst.compare(o.est,e);
 h+='<div class="scroll"><table class="t"><thead><tr><th>Гл.</th><th>Наименование</th><th class="n">'+esc(name(o))+'</th><th class="n">'+esc(name(n))+'</th><th class="n">Разница</th></tr></thead><tbody>'+
  c.rows.map(r=>'<tr><td class="n">'+r.n+'</td><td>'+(r.items.length?'<details class="ch"><summary>'+esc(r.name)+'</summary><div class="sub">'+r.items.slice(0,40).map(i=>esc(i.name)+': '+fmtN(i.a)+' → '+fmtN(i.b)+' (<span class="'+cls(i.d)+'">'+sgn(i.d)+'</span>)').join('<br>')+'</div></details>':esc(r.name))+'</td><td class="n">'+fmtN(r.a)+'</td><td class="n">'+fmtN(r.b)+'</td><td class="n '+cls(r.d)+'">'+sgn(r.d)+'<br><small>'+pct(r.d,r.a)+'</small></td></tr>').join('')+
  '<tr class="tot"><td></td><td>Всего по ССР</td><td class="n">'+fmtN(c.grand.a)+'</td><td class="n">'+fmtN(c.grand.b)+'</td><td class="n '+cls(c.grand.d)+'">'+sgn(c.grand.d)+'<br><small>'+pct(c.grand.d,c.grand.a)+'</small></td></tr></tbody></table></div>'+
  '<p class="sub">Красным — удорожание, зелёным — снижение. Нажмите на главу, чтобы увидеть изменившиеся строки.</p>';
 return h;
}
async function importEst(file){
 const n=S.cur&&notes.get(S.cur);if(!n||!file)return;
 toast('Читаю '+file.name+'…');
 try{
  const e=await SMEst.parseFile(file);
  n.est=cleanEst(e);
  if(!n.fields['Сумма, ₽']&&e.grand!=null)n.fields['Сумма, ₽']=fmtN(e.grand);
  if(!n.fields['Источник'])n.fields['Источник']=file.name;
  touch(n);flush(n.id);renderNote();
  toast('Найдено глав: '+e.chapters.length+', всего '+fmtN(e.grand));
  if(SMDrive.connected()){
   try{const up=await SMDrive.uploadFile(file);const cur=notes.get(n.id);if(cur&&cur.est&&up.webViewLink){cur.est.driveLink=up.webViewLink;touch(cur);if(S.cur===cur.id&&!inEditor())renderNote()}}
   catch(err){toast('Смета прочитана, но исходный файл не сохранён на Диск: '+err.message)}
  }
 }catch(err){toast(err.message)}
}

/* ================= контакты ================= */
const tel=s=>String(s).replace(/[^\d+]/g,'');
function projectsOf(p){
 const out=new Map();
 for(const id of adj.get(p.id)||[]){const o=notes.get(id);if(!o)continue;
  if(o.type==='object')out.set(o.id,o);
  if(o.type==='party')for(const j of adj.get(o.id)||[]){const x=notes.get(j);if(x&&x.type==='object')out.set(x.id,x)}}
 return [...out.values()];
}
function personCard(p){
 const f=p.fields,ph=f['Телефон'],em=f['Email'],pr=projectsOf(p);
 return '<div class="card" style="--c:'+TYPES.person.c+'"><button class="nm" data-open="'+esc(p.id)+'">'+esc(name(p))+'</button>'+
  '<div class="ro">'+inline([f['Должность'],f['Организация']].filter(Boolean).join(' · ')||'—')+'</div>'+
  '<div class="ln">'+(ph?'<a class="btn" href="tel:'+esc(tel(ph))+'">'+esc(ph)+'</a>':'')+(em?'<a class="btn" href="mailto:'+esc(em.trim())+'">'+esc(em)+'</a>':'')+'</div>'+
  (pr.length?'<div class="ln">'+pr.map(o=>'<button class="chip" data-open="'+esc(o.id)+'">'+dot('object')+esc(name(o))+'</button>').join('')+'</div>':'')+'</div>';
}
function renderContacts(){
 const objs=[...notes.values()].filter(n=>n.type==='object').sort((a,b)=>name(a).localeCompare(name(b),'ru'));
 $('#nview').innerHTML='<div class="sheet"><div class="bar"><button class="btn only-m" id="bk">← Назад</button><h1 class="ttl" style="margin:0;width:auto">Контакты</h1><span class="sp"></span><button class="btn pri" id="cNew">+ Контакт</button></div>'+
  '<div class="ctool"><input class="inp" id="cq" type="search" placeholder="Имя, должность, организация, телефон" value="'+esc(S.cq)+'"><select id="cproj"><option value="">Все проекты</option>'+objs.map(o=>'<option value="'+esc(o.id)+'"'+(o.id===S.cproj?' selected':'')+'>'+esc(name(o))+'</option>').join('')+'</select></div><div class="cards" id="cards"></div></div>';
 renderCards();
}
function renderCards(){
 const q=S.cq.toLowerCase();
 const a=[...notes.values()].filter(n=>n.type==='person').filter(p=>(!q||(p.title+' '+Object.values(p.fields).join(' ')).toLowerCase().includes(q))&&(!S.cproj||projectsOf(p).some(o=>o.id===S.cproj))).sort((x,y)=>name(x).localeCompare(name(y),'ru'));
 $('#cards').innerHTML=a.length?a.map(personCard).join(''):'<p class="empty">'+([...notes.values()].some(n=>n.type==='person')?'Никого не найдено.':'Контактов пока нет. Добавьте первый — и свяжите его с объектом связью «контакт по».')+'</p>';
}
function contactsOfNote(n){
 const ps=[...(adj.get(n.id)||[])].map(id=>notes.get(id)).filter(o=>o&&o.type==='person');
 return '<h2 class="sec">Контакты <small>'+ps.length+'</small><button class="btn sm" id="addPerson">+ Контакт</button></h2>'+(ps.length?'<div class="cards">'+ps.map(personCard).join('')+'</div>':'<p class="empty">Контактов по этой карточке нет.</p>');
}

/* ================= карточка ================= */
function hello(){
 return '<div class="hello"><h1>Второй мозг для строительных проектов</h1><p>Карточки — объекты, контракты, сметы, решения, нормативы, организации, контакты, документы и задачи. Связывайте их через <code>[[Название]]</code> или типизированные связи: граф, хронология и сравнение смет соберутся сами.</p>'+
 '<div class="legend">'+Object.keys(TYPES).map(k=>'<span>'+dot(k)+' '+TYPES[k].n+'</span>').join('')+'</div>'+
 '<div class="bar"><button class="btn pri" data-new="object">+ Новый объект</button>'+(notes.size?'':'<button class="btn" id="demo">Создать пример проекта</button>')+'</div></div>';
}
function renderNote(){
 const v=$('#nview'),n=S.cur&&notes.get(S.cur);
 if(!n){v.innerHTML=hello();return}
 const t=TYPES[n.type],E=S.edit,dup=n.title.trim()&&[...notes.values()].some(o=>o.id!==n.id&&o.title.trim().toLowerCase()===n.title.trim().toLowerCase());
 const cells='<div class="cell"><label>Тип</label>'+(E?'<div class="tcell">'+dot(n.type)+'<select id="ftype">'+Object.entries(TYPES).map(([k,x])=>'<option value="'+k+'"'+(k===n.type?' selected':'')+'>'+x.n+'</option>').join('')+'</select></div>':'<div class="v tcell">'+dot(n.type)+t.n+'</div>')+'</div>'+
  t.f.map(f=>'<div class="cell"><label>'+esc(f)+'</label>'+(E?'<input data-f="'+esc(f)+'" value="'+esc(n.fields[f]||'')+'"'+(/Организация|Заказчик|Кто принял|Документ|От кого|Кому|Ответственный/.test(f)?' list="titles"':'')+(f==='Телефон'?' type="tel"':f==='Email'?' type="email"':'')+'>':'<div class="v">'+fieldView(f,n.fields[f])+'</div>')+'</div>').join('')+
  Object.keys(n.fields).filter(k=>!t.f.includes(k)&&n.fields[k]).map(k=>'<div class="cell"><label>'+esc(k)+'</label><div class="v">'+inline(n.fields[k])+'</div></div>').join('');
 const rv=n.rels.filter(r=>r.t.trim());
 const rels=E?n.rels.map((r,i)=>'<div class="rel"><select data-ri="'+i+'">'+RELS.map(x=>'<option'+(x===r.r?' selected':'')+'>'+x+'</option>').join('')+'</select><input data-rt="'+i+'" value="'+esc(r.t)+'" list="titles" placeholder="Название карточки"><button class="x" data-rx="'+i+'" aria-label="Убрать связь">×</button></div>').join('')+'<button class="btn" id="radd">+ Связь</button>'
  :(rv.length?'<div class="rlist">'+rv.map(r=>'<span class="rtag"><em>'+esc(r.r)+' →</em>'+inline('[['+r.t.replace(/^\[\[|\]\]$/g,'')+']]')+'</span>').join('')+'</div>':'<p class="empty">Связей нет.</p>');
 const bm=new Map();for(const b of backs.get(n.id)||[]){if(!bm.has(b.from))bm.set(b.from,new Set());bm.get(b.from).add(b.r)}
 const bl=[...bm].map(([from,rs])=>({from,r:[...rs].join(', ')}));
 v.innerHTML='<div class="sheet"><div class="bar"><button class="btn only-m" id="bk">← Назад</button>'+
  '<button class="btn'+(E?'':' on')+'" id="mView">Просмотр</button><button class="btn'+(E?' on':'')+'" id="mEdit">Править</button><span class="sp"></span>'+
  '<button class="btn" id="lg">Граф связей</button><button class="btn dang" id="del">Удалить</button></div>'+
  '<input class="ttl" id="ftitle" value="'+esc(n.title)+'" placeholder="Название карточки"'+(E?'':' readonly')+'>'+
  '<div class="warn">'+(dup?'Карточка с таким названием уже есть — ссылки будут вести на одну из них.':'')+'</div>'+
  '<div class="stamp">'+cells+'</div>'+
  (n.type==='estimate'?estSection(n):'')+
  '<h2 class="sec">Связи</h2>'+rels+
  (n.type==='object'||n.type==='party'||n.type==='contract'?contactsOfNote(n):'')+
  '<h2 class="sec">Текст <small>'+(E?'[[ — ссылка на карточку · - [ ] — пункт с галочкой · ## — заголовок':'')+'</small></h2>'+
  (E?'<textarea class="md" id="fbody" placeholder="Пишите. [[Название]] создаёт связь.">'+esc(n.body)+'</textarea><div id="sugg"></div>':'<div class="rend">'+md(n.body)+'</div>')+
  (n.type==='person'?'':'<details'+(n.type==='object'?' open':'')+' class="ch"><summary><h2 class="sec" style="display:inline-flex;border:0">Хронология</h2></summary>'+timeline(n)+'</details>')+
  '<h2 class="sec">Обратные ссылки <small>'+bl.length+'</small></h2>'+
  (bl.length?'<ul class="back">'+bl.map(b=>{const o=notes.get(b.from);return '<li><button data-open="'+esc(o.id)+'">'+dot(o.type)+esc(name(o))+'<em>'+esc(b.r)+'</em></button></li>'}).join('')+'</ul>':'<p class="empty">На эту карточку пока никто не ссылается.</p>')+
  '<div class="meta">Создана '+fmt(n.created)+' · изменена '+fmt(n.updated)+'</div></div>';
}
function fieldView(f,val){
 if(!val)return '<span class="empty">—</span>';
 if(f==='Телефон')return '<a class="ext" href="tel:'+esc(tel(val))+'">'+esc(val)+'</a>';
 if(f==='Email')return '<a class="ext" href="mailto:'+esc(val.trim())+'">'+esc(val)+'</a>';
 return inline(val);
}
function open(id,edit){
 flushAll();S.cur=id;S.edit=!!edit;go('note');renderNote();renderList();$('#main').scrollTop=0;
}
function create(type,title,extra){
 const t=TYPES[type]||TYPES.note,n={id:uid(),title:title||'',type:TYPES[type]?type:'note',fields:{},body:t.tpl,rels:[],created:Date.now(),updated:Date.now()};
 if(extra)extra(n);
 notes.set(n.id,n);dirty.set(n.id,0);flush(n.id);open(n.id,true);setTimeout(()=>{const e=$('#ftitle');if(e&&!title)e.focus()},50);return n;
}
function openTitle(t){const id=byTitle.get(t.trim().toLowerCase());if(id)open(id);else create('note',t.trim())}

/* ================= переименование ================= */
function renameLinks(oldT,newT,selfId){
 const re=new RegExp('\\[\\['+escRe(oldT.trim())+'(\\]\\]|\\|)','gi');let cnt=0;
 for(const n of notes.values()){
  let ch=false;const nb=n.body.replace(re,(m,end)=>{ch=true;return '[['+newT.trim()+end});
  if(ch)n.body=nb;
  for(const k in n.fields){const v=n.fields[k].replace(re,(m,end)=>{ch=true;return '[['+newT.trim()+end});n.fields[k]=v}
  for(const r of n.rels)if(r.t.replace(/^\[\[|\]\]$/g,'').trim().toLowerCase()===oldT.trim().toLowerCase()){r.t=newT.trim();ch=true}
  if(ch&&n.id!==selfId){cnt++;n.updated=Date.now();unsynced.add(n.id)}
 }
 saveCache();reindex();pushAll();return cnt;
}

/* ================= навигация ================= */
function go(v){
 S.view=v;document.body.classList.toggle('v-list',v==='list');document.body.classList.toggle('graph',v==='graph');
 for(const [id,k] of [['mList','list'],['mGraph','graph'],['mContacts','contacts'],['tGraph','graph'],['tContacts','contacts']])$('#'+id).classList.toggle('on',v===k);
 if(v==='graph')requestAnimationFrame(()=>{sizeCv();buildGraph()});else stopSim();
 if(v==='contacts'){renderContacts();$('#main').scrollTop=0}
}
let tt=0;function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),3500)}

/* ================= события ================= */
$('#q').addEventListener('input',e=>{S.q=e.target.value;renderList()});
$('#chips').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;S.type=b.dataset.t||null;renderChips();renderList();if(S.view==='graph')buildGraph()});
$('#list').addEventListener('click',e=>{const b=e.target.closest('.it');if(b)open(b.dataset.id)});
$('#tNew').onclick=$('#mNew').onclick=()=>create(S.view==='contacts'?'person':S.type||'note');
$('#tGraph').onclick=()=>{S.gFocus=null;go(S.view==='graph'?(S.cur?'note':'list'):'graph')};
$('#mGraph').onclick=()=>{S.gFocus=null;go('graph')};
$('#tContacts').onclick=$('#mContacts').onclick=()=>{flushAll();go('contacts')};
$('#mList').onclick=()=>{flushAll();go('list')};
const nv=$('#nview');
nv.addEventListener('click',e=>{
 const T=e.target,n=S.cur&&notes.get(S.cur);
 const w=T.closest('a.wl');if(w){e.preventDefault();openTitle(w.dataset.t);return}
 const op=T.closest('[data-open]');if(op){open(op.dataset.open);return}
 const nb=T.closest('[data-new]');if(nb){create(nb.dataset.new);return}
 const sg=T.closest('[data-sg]');if(sg){insertLink(sg.dataset.sg);return}
 if(T.id==='demo'){demo();return}
 if(T.id==='bk'){flushAll();go('list');return}
 if(T.id==='cNew'){const pid=S.cproj&&notes.get(S.cproj);create('person','',pid?x=>{x.rels.push({r:'контакт по',t:pid.title})}:null);return}
 if(S.view!=='note'||!n)return;
 if(T.id==='mView'){flushAll();S.edit=false;renderNote()}
 if(T.id==='mEdit'){S.edit=true;renderNote()}
 if(T.id==='lg'){flushAll();S.gFocus=n.id;go('graph')}
 if(T.id==='estLoad')$('#estFile').click();
 if(T.id==='addPerson'){const ttl=n.title;create('person','',n.type==='party'?x=>{x.fields['Организация']='[['+ttl+']]'}:x=>{x.rels.push({r:'контакт по',t:ttl})})}
 if(T.id==='radd'){n.rels.push({r:RELS[0],t:''});touch(n);renderNote();const r=nv.querySelectorAll('[data-rt]');r[r.length-1].focus()}
 if(T.dataset.rx!=null){n.rels.splice(+T.dataset.rx,1);touch(n);renderNote()}
 if(T.id==='del'){if(T.dataset.sure){remove(n.id);S.cur=null;refresh();go('list');renderNote();toast('Карточка удалена')}else{T.dataset.sure=1;T.textContent='Точно удалить?';setTimeout(()=>{if(T.isConnected){delete T.dataset.sure;T.textContent='Удалить'}},3500)}}
});
nv.addEventListener('focusin',e=>{if(e.target.id==='ftitle'){const n=notes.get(S.cur);S.oldTitle=n?n.title:null}});
nv.addEventListener('input',e=>{
 const T=e.target;
 if(T.id==='cq'){S.cq=T.value;renderCards();return}
 const n=S.cur&&notes.get(S.cur);if(!n||S.view!=='note')return;
 if(T.id==='ftitle'){n.title=T.value;touch(n)}
 else if(T.dataset.f!=null){n.fields[T.dataset.f]=T.value;touch(n)}
 else if(T.dataset.rt!=null){n.rels[+T.dataset.rt].t=T.value;touch(n)}
 else if(T.id==='fbody'){n.body=T.value;touch(n);suggest(T)}
});
nv.addEventListener('change',e=>{
 const T=e.target;
 if(T.id==='cproj'){S.cproj=T.value;renderCards();return}
 const n=S.cur&&notes.get(S.cur);if(!n||S.view!=='note')return;
 if(T.id==='ftitle'){const o=S.oldTitle;S.oldTitle=n.title;if(o&&o.trim()&&n.title.trim()&&o.trim()!==n.title.trim()){flush(n.id);const c=renameLinks(o,n.title,n.id);if(c)toast('Ссылки обновлены в карточках: '+c)}}
 else if(T.id==='ftype'){n.type=T.value;if(!n.body.trim())n.body=TYPES[n.type].tpl;touch(n);renderNote()}
 else if(T.id==='estFile'){importEst(T.files[0]);T.value=''}
 else if(T.id==='cmpSel'){S.cmp[n.id]=T.value;renderNote()}
 else if(T.dataset.ri!=null){n.rels[+T.dataset.ri].r=T.value;touch(n)}
 else if(T.dataset.ln!=null){const L=n.body.split('\n'),i=+T.dataset.ln;L[i]=L[i].replace(/\[( |x|х)\]/i,T.checked?'[x]':'[ ]');n.body=L.join('\n');touch(n)}
});
nv.addEventListener('keyup',e=>{if(e.target.id==='fbody')suggest(e.target)});
function suggest(ta){
 const before=ta.value.slice(0,ta.selectionStart),m=before.match(/\[\[([^\]\n]*)$/),box=$('#sugg');if(!box)return;
 if(!m){box.innerHTML='';return}
 const q=m[1].toLowerCase(),a=[...notes.values()].filter(n=>n.id!==S.cur&&n.title.trim()&&n.title.toLowerCase().includes(q)).slice(0,8);
 box.innerHTML=a.map(n=>'<button class="chip" data-sg="'+esc(n.title)+'">'+dot(n.type)+esc(n.title)+'</button>').join('')+(q&&!a.some(n=>n.title.toLowerCase()===q)?'<button class="chip" data-sg="'+esc(m[1])+'">+ новая: '+esc(m[1])+'</button>':'');
}
function insertLink(title){
 const ta=$('#fbody'),n=notes.get(S.cur);if(!ta||!n)return;
 const p=ta.selectionStart,b=ta.value.slice(0,p).replace(/\[\[([^\]\n]*)$/,'[['+title+']]'),a=ta.value.slice(p).replace(/^\]\]/,'');
 ta.value=b+a;n.body=ta.value;touch(n);ta.focus();ta.setSelectionRange(b.length,b.length);$('#sugg').innerHTML='';
}
window.addEventListener('pagehide',()=>{flushAll();saveCache()});
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushAll();else pull()});
setInterval(()=>{if(!document.hidden)pull()},60000);

/* ================= экспорт / импорт ================= */
$('#exp').onclick=()=>{
 flushAll();
 const blob=new Blob([JSON.stringify({app:'stroymozg',version:2,exported:new Date().toISOString(),notes:[...notes.values()]},null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='stroymozg-'+new Date().toISOString().slice(0,10)+'.json';
 document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
};
$('#imp').onclick=()=>$('#impFile').click();
$('#impFile').onchange=async e=>{
 const f=e.target.files[0];e.target.value='';if(!f)return;
 try{
  const d=JSON.parse(await f.text()),arr=Array.isArray(d)?d:d.notes;
  if(!Array.isArray(arr))throw new Error('В файле нет списка карточек');
  let k=0;for(const x of arr){const n=clean(x.id||uid(),x);if(n){notes.set(n.id,n);unsynced.add(n.id);k++}}
  saveCache();refresh(true);pushAll();toast('Импортировано карточек: '+k);
 }catch(err){toast('Не удалось импортировать: '+err.message)}
};

/* ================= граф ================= */
const cv=$('#cv'),cx=cv.getContext('2d'),pos=new Map();
const G={nodes:[],links:[],k:1,ox:0,oy:0,alpha:0,raf:0,fitted:false,W:0,H:0};
function sizeCv(){const r=cv.getBoundingClientRect(),d=devicePixelRatio||1;G.W=r.width;G.H=r.height;cv.width=r.width*d;cv.height=r.height*d;cx.setTransform(d,0,0,d,0,0);draw()}
new ResizeObserver(()=>{if(S.view==='graph')sizeCv()}).observe(cv);
function buildGraph(){
 let ids=new Set([...notes.values()].filter(n=>!S.type||n.type===S.type).map(n=>n.id));
 if(S.gFocus&&notes.has(S.gFocus))ids=near(S.gFocus,S.gDepth);else S.gFocus=null;
 const deg={};for(const e of edges)if(ids.has(e.a)&&ids.has(e.b)){deg[e.a]=(deg[e.a]||0)+1;deg[e.b]=(deg[e.b]||0)+1}
 G.nodes=[...ids].map(id=>{const p=pos.get(id)||{x:(Math.random()-.5)*300,y:(Math.random()-.5)*300,vx:0,vy:0};pos.set(id,p);p.id=id;p.d=deg[id]||0;return p});
 const idx=new Map(G.nodes.map(n=>[n.id,n]));
 G.links=edges.filter(e=>idx.has(e.a)&&idx.has(e.b)).map(e=>({s:idx.get(e.a),t:idx.get(e.b),r:e.r}));
 G.fitted=false;G.alpha=1;startSim();renderGtool();
 $('#ginfo').textContent=G.nodes.length?'Карточек: '+G.nodes.length+' · связей: '+G.links.length+' · нажмите на точку, чтобы открыть':'Нет карточек для графа';
}
function renderGtool(){
 const f=S.gFocus&&notes.get(S.gFocus);
 $('#gtool').innerHTML=(f?'<button class="btn" id="gAll">← Весь граф</button><button class="btn'+(S.gDepth===1?' on':'')+'" data-dp="1">1 шаг</button><button class="btn'+(S.gDepth===2?' on':'')+'" data-dp="2">2 шага</button>':'')+
  '<button class="btn" id="gFit">Вписать</button><button class="btn" id="gIn" aria-label="Приблизить">+</button><button class="btn" id="gOut" aria-label="Отдалить">−</button>';
}
$('#gtool').addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.id==='gAll'){S.gFocus=null;buildGraph()}
 if(b.dataset.dp){S.gDepth=+b.dataset.dp;buildGraph()}
 if(b.id==='gFit')fit();
 if(b.id==='gIn')zoom(1.25,G.W/2,G.H/2);
 if(b.id==='gOut')zoom(.8,G.W/2,G.H/2);
});
function startSim(){if(!G.raf)G.raf=requestAnimationFrame(step)}
function stopSim(){cancelAnimationFrame(G.raf);G.raf=0}
function step(){
 G.raf=0;const N=G.nodes,a=G.alpha;
 for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){
  const p=N[i],q=N[j];let dx=q.x-p.x,dy=q.y-p.y,d2=dx*dx+dy*dy||.01;if(d2>360000)continue;
  const f=3200/d2*a,d=Math.sqrt(d2);dx/=d;dy/=d;p.vx-=dx*f;p.vy-=dy*f;q.vx+=dx*f;q.vy+=dy*f;
 }
 for(const l of G.links){const dx=l.t.x-l.s.x,dy=l.t.y-l.s.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-150)*.03*a;l.s.vx+=dx/d*f;l.s.vy+=dy/d*f;l.t.vx-=dx/d*f;l.t.vy-=dy/d*f}
 for(const p of N){p.vx-=p.x*.006*a;p.vy-=p.y*.006*a;if(p!==drag.node){p.x+=p.vx;p.y+=p.vy}p.vx*=.8;p.vy*=.8}
 G.alpha*=.985;
 if(!G.fitted&&G.alpha<.35){fit();G.fitted=true}
 draw();if(G.alpha>.02||drag.node)G.raf=requestAnimationFrame(step);
}
function fit(){
 if(!G.nodes.length){G.k=1;G.ox=G.W/2;G.oy=G.H/2;draw();return}
 let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of G.nodes){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y)}
 const pad=70;G.k=Math.min(2,Math.max(.2,Math.min((G.W-pad*2)/((x1-x0)||1),(G.H-pad*2-50)/((y1-y0)||1))));
 G.ox=G.W/2-(x0+x1)/2*G.k;G.oy=G.H/2+25-(y0+y1)/2*G.k;draw();
}
function zoom(f,sx,sy){const k=Math.min(4,Math.max(.15,G.k*f));G.ox=sx-(sx-G.ox)*k/G.k;G.oy=sy-(sy-G.oy)*k/G.k;G.k=k;draw()}
const rad=p=>6+Math.min(p.d,12)*1.1;
let hover=null;
function draw(){
 if(S.view!=='graph')return;
 const ink=getComputedStyle(document.body).color,mute=getComputedStyle($('#ginfo')).color,bg=getComputedStyle($('#ginfo')).backgroundColor;
 cx.clearRect(0,0,G.W,G.H);cx.save();cx.translate(G.ox,G.oy);cx.scale(G.k,G.k);
 const hl=hover&&new Set([hover.id,...G.links.filter(l=>l.s===hover||l.t===hover).flatMap(l=>[l.s.id,l.t.id])]);
 for(const l of G.links){const on=hl&&hl.has(l.s.id)&&hl.has(l.t.id);cx.strokeStyle=on?ink:mute;cx.globalAlpha=on?1:.5;cx.lineWidth=(on?2:1.2)/G.k;cx.setLineDash(l.r==='ссылка'?[]:[6/G.k,4/G.k]);cx.beginPath();cx.moveTo(l.s.x,l.s.y);cx.lineTo(l.t.x,l.t.y);cx.stroke()}
 cx.setLineDash([]);cx.globalAlpha=1;
 for(const p of G.nodes){const n=notes.get(p.id);if(!n)continue;const r=rad(p);cx.globalAlpha=hl&&!hl.has(p.id)?.25:1;
  cx.fillStyle=TYPES[n.type].c;cx.beginPath();cx.arc(p.x,p.y,r,0,7);cx.fill();
  if(p.id===S.gFocus||p.id===S.cur){cx.strokeStyle=ink;cx.lineWidth=2.5/G.k;cx.beginPath();cx.arc(p.x,p.y,r+4/G.k,0,7);cx.stroke()}}
 cx.textAlign='center';cx.textBaseline='top';
 for(const p of G.nodes){const n=notes.get(p.id);if(!n)continue;if(G.k<.55&&!(hl&&hl.has(p.id))&&p.d<4)continue;
  const dim=hl&&!hl.has(p.id);let s=name(n);if(s.length>34)s=s.slice(0,32)+'…';
  const fs=14/Math.max(G.k,.7);cx.font=fs+'px "PT Sans Narrow", sans-serif';const w=cx.measureText(s).width,y=p.y+rad(p)+3;
  cx.globalAlpha=(dim?.25:1)*.85;cx.fillStyle=bg;cx.fillRect(p.x-w/2-3,y-1,w+6,fs+3);cx.globalAlpha=dim?.25:1;cx.fillStyle=hl&&hl.has(p.id)?ink:mute;cx.fillText(s,p.x,y)}
 cx.globalAlpha=1;cx.restore();
}
const drag={node:null,pan:false,sx:0,sy:0,moved:0},ptrs=new Map();let pinch=0;
const world=(x,y)=>({x:(x-G.ox)/G.k,y:(y-G.oy)/G.k});
function hit(x,y){const w=world(x,y);let best=null,bd=1e9;for(const p of G.nodes){const d=Math.hypot(p.x-w.x,p.y-w.y);if(d<rad(p)+10/G.k&&d<bd){bd=d;best=p}}return best}
const loc=e=>{const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
cv.addEventListener('pointerdown',e=>{
 cv.setPointerCapture(e.pointerId);const p=loc(e);ptrs.set(e.pointerId,p);
 if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);drag.node=null;drag.pan=false;return}
 drag.node=hit(p.x,p.y);drag.pan=!drag.node;drag.sx=p.x;drag.sy=p.y;drag.moved=0;if(drag.node){G.alpha=Math.max(G.alpha,.3);startSim()}
});
cv.addEventListener('pointermove',e=>{
 const p=loc(e);
 if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,p);
 if(ptrs.size===2&&pinch){const [a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y);zoom(d/pinch,(a.x+b.x)/2,(a.y+b.y)/2);pinch=d;return}
 if(!ptrs.size){const h=hit(p.x,p.y);if(h!==hover){hover=h;cv.style.cursor=h?'pointer':'grab';draw()}return}
 const dx=p.x-drag.sx,dy=p.y-drag.sy;drag.moved+=Math.abs(dx)+Math.abs(dy);drag.sx=p.x;drag.sy=p.y;
 if(drag.node){const w=world(p.x,p.y);drag.node.x=w.x;drag.node.y=w.y;G.alpha=Math.max(G.alpha,.3);startSim()}
 else if(drag.pan){G.ox+=dx;G.oy+=dy;draw()}
});
const up=e=>{
 ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=0;
 if(drag.node&&drag.moved<8){const id=drag.node.id;drag.node=null;open(id);return}
 drag.node=null;drag.pan=false;
};
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
cv.addEventListener('pointerleave',()=>{if(!ptrs.size&&hover){hover=null;draw()}});
cv.addEventListener('wheel',e=>{e.preventDefault();const p=loc(e);zoom(e.deltaY<0?1.12:.89,p.x,p.y)},{passive:false});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw);

/* ================= пример проекта ================= */
function demo(){
 const P=' (пример)',L=t=>'[['+t+P+']]';
 const mk=(type,title,fields,body,rels,est)=>{const n={id:uid(),title:title+P,type,fields:fields||{},body:body||'',rels:(rels||[]).map(([r,t])=>({r,t:t+P})),created:Date.now(),updated:Date.now()};if(est)n.est=est;notes.set(n.id,n);unsynced.add(n.id);return n};
 const ch=(n,name,items)=>({n,name,total:items.reduce((s,i)=>s+i[1],0),items:items.map(([name,total])=>({name,total}))});
 const e1={file:'ССР_вер1.xlsx',sheet:'ССР',imported:Date.now(),vat:8303.33,subtotals:[],chapters:[
  ch(1,'Подготовка территории строительства',[['ЛСР 01-01-01 Демонтаж',612.4]]),
  ch(2,'Основные объекты строительства',[['ЛСР 02-01-01 Котельная, ТМ',21450.8],['ЛСР 02-01-02 Тепловая сеть',9120.5]]),
  ch(8,'Временные здания и сооружения',[['ГСН 81-05-01-2001 1,8 %',560.6]]),
  ch(9,'Прочие работы и затраты',[['Зимнее удорожание',980],['Перевозка рабочих',700]]),
  ch(12,'Проектные и изыскательские работы',[['Проектные работы',8092]])]};
 e1.grand=Math.round((e1.chapters.reduce((s,c)=>s+c.total,0)+e1.vat)*100)/100;
 const e2=JSON.parse(JSON.stringify(e1));e2.file='ССР_вер2.xlsx';e2.chapters=e2.chapters.filter(c=>c.n!==9);
 e2.chapters[1].items[1].total=9350.2;e2.chapters[1].total=21450.8+9350.2;e2.vat=8012.5;e2.grand=Math.round((e2.chapters.reduce((s,c)=>s+c.total,0)+e2.vat)*100)/100;
 mk('party','МУП «Теплосеть»',{'Роль':'Заказчик','Телефон':'+7 (495) 000-00-00'},'## Заметки\n- Замечания по сметам присылают письмами, срок ответа — 5 рабочих дней');
 const o=mk('object','Котельная №3, ул. Заводская',{'Адрес':'ул. Заводская, 12','Заказчик':L('МУП «Теплосеть»'),'Стадия':'РД','Бюджет, ₽':'48 600 000'},'## Описание\nЗамена двух котлов и реконструкция тепловой сети до ЦТП-2.\n\n## Открытые вопросы\n- [ ] Подтвердить коэффициент на стеснённые условия\n- [x] Получить ТУ на подключение');
 mk('person','Иванов Сергей Петрович',{'Должность':'Главный инженер','Организация':L('МУП «Теплосеть»'),'Телефон':'+7 (900) 000-00-01','Email':'ivanov@example.ru'},'## Заметки\n- Согласует сметы, лучше звонить до 11:00',[['контакт по','Котельная №3, ул. Заводская']]);
 mk('person','Петрова Анна',{'Должность':'Ведущий сметчик','Организация':'ООО «Проект-Сервис»','Телефон':'+7 (900) 000-00-02','Email':'petrova@example.ru'},'',[['контакт по','Котельная №3, ул. Заводская']]);
 mk('contract','Контракт 12/2026',{'Номер':'12/2026','Дата':'03.03.2026','Сумма, ₽':'46 950 000','Срок окончания':'30.09.2027'},'## Предмет\nСМР по '+L('Котельная №3, ул. Заводская'),[['относится к','Котельная №3, ул. Заводская']]);
 mk('estimate','ССР вер. 1',{'Версия':'1','Сумма, ₽':fmtN(e1.grand),'Источник':'Гранд-Смета, xlsx','Дата':'15.08.2026'},'',[['относится к','Котельная №3, ул. Заводская']],e1);
 mk('doc','Письмо № 341 от 14.10.2026',{'Номер':'341','Дата':'14.10.2026','От кого':L('МУП «Теплосеть»'),'Кому':'Проектный отдел'},'## Содержание\nПросят исключить затраты гл. 9 и пересчитать ССР.',[['относится к','Котельная №3, ул. Заводская']]);
 mk('decision','Исключить гл. 9 из ССР',{'Дата':'16.10.2026','Кто принял':L('Иванов Сергей Петрович'),'Документ':L('Письмо № 341 от 14.10.2026')},'## Суть решения\nЗатраты гл. 9 переносятся в отдельный договор.\n\n## На что повлияло\n- '+L('ССР вер. 2'),[['основание','Письмо № 341 от 14.10.2026']]);
 mk('estimate','ССР вер. 2',{'Версия':'2','Сумма, ₽':fmtN(e2.grand),'Источник':'Гранд-Смета, xlsx','Дата':'20.10.2026'},'## Что изменилось\n- Исключена гл. 9\n- Уточнён объём тепловой сети',[['заменяет','ССР вер. 1'],['основание','Исключить гл. 9 из ССР'],['относится к','Котельная №3, ул. Заводская']],e2);
 mk('norm','Методика № 421/пр',{'Шифр':'Приказ Минстроя России № 421/пр'},'## Где применял\n- '+L('ССР вер. 2'));
 mk('task','Согласовать ССР вер. 2 с заказчиком',{'Статус':'Открыта','Срок':'01.12.2026','Ответственный':L('Петрова Анна')},'- [ ] Отправить ССР вер. 2\n- [ ] Получить подпись',[['относится к','ССР вер. 2']]);
 saveCache();refresh();pushAll();open(o.id);
}

/* ================= старт ================= */
loadCache();reindex();renderChips();renderList();renderNote();status();
if(SMDrive.restore())pull();
}
