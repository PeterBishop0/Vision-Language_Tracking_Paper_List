/* VLT Institution Atlas v1. Group membership is strictly based on source-verified
   first/co-first/corresponding authorship annotations in data/paper_roles.csv.
   Other coauthors are visualized but NOT treated as institution members. */
'use strict';
const $ = id => document.getElementById(id);
const byId = new Map();
let db = null, cy = null, activeInstitute = null, selectedAuthor = null, activeRole = 'all';
let filteredPapers = [];
const collator = new Intl.Collator('en',{sensitivity:'base'});
const ROLES = {first:'第一作者',cofirst:'共同第一作者',corresponding:'通讯作者'};
const COLORS = ['#477bee','#10ada6','#8c79d7','#ec9b4c','#6299bc','#d47a9e'];
const e = (tag,text='',cls='') => {const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
function link(parent,text,href,cls='') {const n=e('a',text,cls);if(typeof href==='string'&&/^https?:\/\//.test(href)){n.href=href;n.target='_blank';n.rel='noopener noreferrer';}parent.appendChild(n);return n;}
function paperMatch(p) {return (!($('category').value)||p.categories.includes($('category').value)) && (!$('ccf').value||p.ccf===$('ccf').value) && p.year>=Number($('fromYear').value) && p.year<=Number($('toYear').value);}
function groupPapers(g) {const ids=new Set(g.paper_ids);return filteredPapers.filter(p=>ids.has(p.id));}
function groupRolePapers(g,role) {const pp=groupPapers(g);if(role==='all')return pp;const allowed=new Set();for(const rep of g.representatives){if(rep.roles.includes(role)||(role==='first'&&rep.roles.includes('cofirst'))) for(const id of rep.paper_ids)allowed.add(id);}return pp.filter(p=>allowed.has(p.id));}
function presentAuthors(g,ps) {const s=new Set(ps.map(p=>p.id));return g.representatives.map(r=>({...r,currentCount:r.paper_ids.filter(id=>s.has(id)).length})).filter(r=>r.currentCount>0).sort((a,b)=>b.currentCount-a.currentCount||collator.compare(a.name,b.name));}
function mark(t,label,cls='') {t.appendChild(e('span',label,'tag '+cls));}
function showOverview() {
  activeInstitute=null;selectedAuthor=null;activeRole='all';if(cy){cy.destroy();cy=null;}
  $('institutionView').hidden=true;$('overview').hidden=false;$('back').hidden=true;$('fit').hidden=true;
  $('viewKicker').textContent='INSTITUTION ATLAS';$('viewTitle').textContent='研究机构一览';
  const q=$('search').value.trim().toLowerCase();const eligible=[];
  for(const g of db.institutions){const ps=groupPapers(g);if(!ps.length)continue;
    const searchMatch=!q||g.name.toLowerCase().includes(q)||g.representatives.some(r=>r.name.toLowerCase().includes(q))||ps.some(p=>p.authors.some(a=>a.toLowerCase().includes(q)));
    if(searchMatch)eligible.push({g,ps});}
  $('viewStatus').textContent=`${filteredPapers.length} 篇论文 · ${eligible.filter(x=>x.g.verified).length} 所已核实机构 · 持续完善中`;
  const host=$('overview');host.replaceChildren();if(!eligible.length){host.appendChild(e('div','没有匹配的机构或论文，请修改筛选条件。','institution-empty'));return;}
  const grid=e('div','','institution-grid');host.appendChild(grid);
  eligible.forEach(({g,ps},i)=>{
    const card=e('button','','institution-card'+(g.verified?'':' pending'));card.type='button';card.style.setProperty('--card-color',g.verified?COLORS[i%COLORS.length]:'#a18a5b');
    const top=e('div','','institution-top');top.append(e('span',g.verified?'INSTITUTION':'PENDING VERIFICATION','institution-code'),e('span',g.verified?'来源已核实':'待补充机构','verified-pill'));
    card.appendChild(top);card.appendChild(e('div',g.verified?g.name:'机构待核实 · Unverified','institution-name'));
    const reps=presentAuthors(g,ps);card.appendChild(e('div',g.verified?'代表作者：'+reps.slice(0,3).map(x=>x.name).join(' · '):'其他论文将保留在此，直到补充可核验的作者机构。','institution-people'));
    const bottom=e('div','','institution-footer');bottom.append(e('span',`${ps.length} 篇论文 · ${reps.length} 位署名代表`),e('b','查看研究者 ↗'));card.appendChild(bottom);
    card.onclick=()=>openInstitution(g.id);grid.appendChild(card);
  });
}
function visiblePapers() {if(!activeInstitute)return [];return groupRolePapers(activeInstitute,activeRole);}
function openInstitution(id) {const g=db.institutions.find(x=>x.id===id);if(!g)return;activeInstitute=g;activeRole='all';selectedAuthor=null;
  $('overview').hidden=true;$('institutionView').hidden=false;$('back').hidden=false;$('fit').hidden=false;
  $('viewKicker').textContent=g.verified?'INSTITUTION PROFILE':'ANNOTATION QUEUE';$('viewTitle').textContent=g.verified?g.name:'机构待核实';
  renderInstitution();}
function renderInstitution(){const g=activeInstitute;if(!g)return;const gp=groupPapers(g);if(!gp.length){showOverview();return;}
  $('viewStatus').textContent=`${gp.length} 篇收录论文 · ${g.verified?'基于已核实作者角色归属':'机构信息尚未核实'}`;
  const host=$('institutionIntro');host.replaceChildren();
  host.append(e('div',g.verified?'VERIFIED AUTHOR AFFILIATION':'AWAITING AUTHOR AFFILIATION','institution-intro-kicker'),
              e('h3',g.verified?g.name:'资料待核实'),
              e('p',g.verified?'本机构仅收录有论文证据支持的一作/共同一作/通讯作者；同篇论文可能对应多个机构。':'尚未找到足够的作者机构信息。下面仍展示第一作者和论文，但不把作者归属于任何具体机构。'));
  const repBox=e('div','','rep-chips');for(const rep of presentAuthors(g,gp).slice(0,12)){
    const chip=e('button',rep.name,'rep-chip');chip.type='button';chip.appendChild(e('small',rep.roles.map(r=>ROLES[r]||r).join(' / ')));
    chip.onclick=()=>{activeRole='all';updateRoleButtons();renderRole();focusAuthor(rep.author_id);};repBox.appendChild(chip);
  }host.appendChild(repBox);
  updateRoleButtons();renderRole();}
function updateRoleButtons() {document.querySelectorAll('.role-btn').forEach(b=>{b.classList.toggle('active',b.dataset.role===activeRole);b.setAttribute('aria-pressed',String(b.dataset.role===activeRole));});}
function renderRole(){if(!activeInstitute)return;const papers=visiblePapers();selectedAuthor=null;
  const status=activeRole==='all'?'全部':activeRole==='first'?'第一作者（含共同一作）':'通讯作者';
  $('roleStatus').textContent=`${status} · ${papers.length} 篇`;
  $('paperCount').textContent=papers.length+' 篇';
  renderPaperList(papers);renderGraph(papers);showDetail(null,papers);}
function roleRecords(p,authorId) {if(!p.verified_roles?.length){if(p.first_author_id===authorId)return [{role:'first',institution:'',evidence_url:''}];return [];}return p.verified_roles.filter(x=>x.author_id===authorId);}
function renderPaperList(ps){const host=$('paperList');host.replaceChildren();if(!ps.length){host.appendChild(e('div','该角色下暂无已核实的论文记录。','institution-empty'));return;}
  for(const p of ps.slice().sort((a,b)=>b.year-a.year)){const c=e('article','','paper-card');link(c,p.title,p.paper_url);
    c.appendChild(e('div',`${p.venue} ${p.year} · CCF ${p.ccf}`,'paper-meta'));
    const tags=e('div','','tags');p.categories.forEach(cat=>mark(tags,cat));
    const recs=p.verified_roles?.filter(x=>x.institution===activeInstitute.name)||[];
    if(recs.length){recs.forEach(x=>mark(tags,`${x.name} · ${ROLES[x.role]}`, 'verified'));}
    else mark(tags,'机构未核实','pending');c.appendChild(tags);host.appendChild(c);}
}
function renderGraph(ps){if(cy){cy.destroy();cy=null;}const wrap=$('cy');wrap.replaceChildren();if(!ps.length){wrap.appendChild(e('div','该筛选条件下没有作者网络。','institution-empty'));return;}
  const counts=new Map(),selectedIds=new Set(ps.map(p=>p.id)),reps=new Map();for(const p of ps){for(const aid of p.author_ids)counts.set(aid,(counts.get(aid)||0)+1);}
  for(const r of activeInstitute.representatives){const n=r.paper_ids.filter(pid=>selectedIds.has(pid)).length;if(n)reps.set(r.author_id,n);}
  const cap=Number($('maxNodes').value),rank=(a,b)=>((reps.has(b)?100:0)+(counts.get(b)||0))-((reps.has(a)?100:0)+(counts.get(a)||0))||collator.compare(byId.get(a)?.name||'',byId.get(b)?.name||'');
  const ids=[...counts.keys()].sort(rank).slice(0,cap),idset=new Set(ids);
  const nodes=ids.map(id=>({data:{id,label:byId.get(id)?.name||id,count:counts.get(id),isRep:reps.has(id)?1:0},classes:reps.has(id)?'verified':'coauthor'}));
  const edges=[];for(const x of db.edges){if(!idset.has(x.source)||!idset.has(x.target))continue;const w=x.paper_ids.filter(pid=>selectedIds.has(pid)).length;if(w)edges.push({data:{id:`${x.source}_${x.target}`,source:x.source,target:x.target,weight:w}});}
  // A minimum spanning forest ensures that the initial view has few edges, yet
  // every actual collaboration remains selectable when an author is focused.
  const parent=new Map(ids.map(id=>[id,id]));const root=x=>{let n=x;while(parent.get(n)!==n)n=parent.get(n);return n;};
  for(const ed of edges.slice().sort((a,b)=>b.data.weight-a.data.weight)){
    const a=root(ed.data.source),b=root(ed.data.target);if(a!==b){parent.set(a,b);ed.classes='backbone';}}
  if(typeof cytoscape!=='function'){wrap.appendChild(e('div','Cytoscape 网络组件加载失败，请检查网络。','error'));return;}
  cy=cytoscape({container:wrap,elements:[...nodes,...edges],minZoom:.18,maxZoom:2.6,wheelSensitivity:.15,
    layout:{name:'concentric',animate:false,fit:true,padding:48,startAngle:Math.PI*1.5,minNodeSpacing:38,concentric:n=>n.data('isRep')?100+(n.data('count')||0):n.data('count')||1,levelWidth:()=>2},
    style:[
      {selector:'node',style:{'label':'data(label)','font-family':'Arial, sans-serif','font-size':10,'font-weight':600,'color':'#536b88','text-valign':'bottom','text-margin-y':7,'text-background-opacity':.88,'text-background-color':'#f9fcff','text-background-padding':'2px','text-wrap':'wrap','text-max-width':'100px','width':'mapData(count,1,10,20,42)','height':'mapData(count,1,10,20,42)','border-width':2,'border-color':'#a2b9d8','background-color':'#fff'}},
      {selector:'node.verified',style:{'background-color':'#477ce9','border-color':'#c4d9ff','border-width':3,'color':'#265db8','font-size':11,'font-weight':700}},
      {selector:'edge',style:{'width':1.3,'line-color':'#aac1df','opacity':.035,'curve-style':'bezier'}},
      {selector:'edge.backbone',style:{'width':1.4,'line-color':'#a6c0e5','opacity':.34}},
      {selector:'node.dimmed',style:{'opacity':.11,'text-opacity':.05}},
      {selector:'edge.dimmed',style:{'opacity':.02}},
      {selector:'node.neighbor',style:{'opacity':1,'border-color':'#8ebafe','border-width':3}},
      {selector:'node.selected',style:{'background-color':'#fa9952','border-color':'#ffe0c3','border-width':6,'font-size':12,'font-weight':800,'color':'#d87b38','opacity':1,'z-index':20}},
      {selector:'edge.related',style:{'opacity':.8,'line-color':'#f0a16a','width':'mapData(weight,1,9,2.2,5)','z-index':12}}
    ]});
  cy.on('tap','node',ev=>focusAuthor(ev.target.id()));
  cy.on('tap',ev=>{if(ev.target===cy){selectedAuthor=null;clearFocus();showDetail(null,ps);}});
  cy.on('mouseover','node',ev=>{if(!selectedAuthor)paintFocus(ev.target);});cy.on('mouseout','node',()=>{if(!selectedAuthor)clearFocus();});
}
function clearFocus(){if(cy)cy.elements().removeClass('dimmed neighbor selected related');}
function paintFocus(n){if(!cy||n.empty())return;clearFocus();cy.nodes().addClass('dimmed');cy.edges().addClass('dimmed');
  const edges=n.connectedEdges(), neighbors=edges.connectedNodes();n.removeClass('dimmed').addClass('selected');neighbors.removeClass('dimmed').addClass('neighbor');edges.removeClass('dimmed').addClass('related');}
function focusAuthor(id){if(!activeInstitute)return;selectedAuthor=id;const n=cy?.getElementById(id);if(n&&!n.empty()){paintFocus(n);cy.animate({center:{eles:n},zoom:Math.min(1.32,Math.max(.85,cy.zoom()))},{duration:270});}
  showDetail(id,visiblePapers());}
function showDetail(id,ps){const host=$('details');host.replaceChildren();if(!id){const blank=e('div','','detail-placeholder');blank.append(e('span','◎'),e('strong','选择一位研究者'),e('p','点击图谱中的作者节点，可查看其论文与已核实的机构、作者角色。'));host.appendChild(blank);return;}
  const a=byId.get(id);if(!a)return;const authored=ps.filter(p=>p.author_ids.includes(id));
  host.append(e('h3',a.name,'detail-title'));
  const attributions=authored.flatMap(p=>(p.verified_roles||[]).filter(x=>x.author_id===id&&x.institution===activeInstitute.name));
  const roleText=attributions.length?`已核实：${[...new Set(attributions.map(x=>ROLES[x.role]))].join(' / ')} · ${activeInstitute.name}`:
      (authored.some(p=>p.first_author_id===id)?'第一作者署名已知，机构待核实':'论文共同署名作者 · 该机构归属未经核实');
  host.appendChild(e('div',roleText,'detail-meta'));
  const collaborators=new Set();authored.forEach(p=>p.author_ids.forEach(aid=>{if(aid!==id)collaborators.add(aid);}));
  const m=e('div','','metric-row');for(const [v,label] of [[authored.length,'相关论文'],[collaborators.size,'共同署名']]){const c=e('div','','mini-metric');c.append(e('strong',String(v)),e('small',label));m.appendChild(c);}host.appendChild(m);
  host.appendChild(e('div','RELEVANT PAPERS','detail-section'));
  for(const p of authored.slice().sort((x,y)=>y.year-x.year).slice(0,18)){const item=e('div','','paper-mini');link(item,p.title,p.paper_url);item.appendChild(e('small',`${p.venue} ${p.year} · CCF ${p.ccf}`));const roles=roleRecords(p,id);const r=roles.filter(x=>!x.institution||x.institution===activeInstitute.name);if(r.length)item.appendChild(e('small',r.map(x=>ROLES[x.role]+(x.institution?' · 来源已核实':' · 机构未核实')).join(' / ')));
    for(const rr of r.filter(x=>x.evidence_url)) link(item,'核实来源 ↗',rr.evidence_url,'source-link');host.appendChild(item);}
}
function setFilters(){filteredPapers=db.papers.filter(paperMatch);if(activeInstitute){renderInstitution();}else showOverview();}
async function start(){try{const response=await fetch('data/graph.json',{cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status}`);db=await response.json();if(!Array.isArray(db.institutions))throw Error('当前图谱数据缺少机构信息，请运行 build_institution_graph.py');
  db.authors.forEach(a=>byId.set(a.id,a));$('statPapers').textContent=db.meta.unique_papers;$('statAuthors').textContent=db.meta.researchers;$('statInstitutions').textContent=db.meta.verified_institutions;
  $('lastBuilt').textContent=`来源：README.md + data/paper_roles.csv · 构建 ${db.meta.generated_utc.slice(0,10)} UTC`;
  const years=db.papers.map(p=>p.year),lo=Math.min(...years),hi=Math.max(...years);for(let y=lo;y<=hi;y++){$('fromYear').appendChild(new Option(String(y),String(y)));$('toYear').appendChild(new Option(String(y),String(y)));}
  $('fromYear').value=String(lo);$('toYear').value=String(hi);
  for(const id of ['search','category','ccf','fromYear','toYear','maxNodes'])$(id).addEventListener(id==='search'?'input':'change',()=>{
    if(id==='search'){activeInstitute=null;setFilters();}else setFilters();});
  $('back').addEventListener('click',()=>{selectedAuthor=null;showOverview();});
  $('fit').addEventListener('click',()=>cy?.fit(undefined,45));
  $('reset').addEventListener('click',()=>{$('search').value='';$('category').value='';$('ccf').value='';$('fromYear').value=String(lo);$('toYear').value=String(hi);$('maxNodes').value='40';activeInstitute=null;setFilters();});
  document.querySelectorAll('.role-btn').forEach(b=>b.addEventListener('click',()=>{activeRole=b.dataset.role;updateRoleButtons();renderRole();}));
  setFilters();
 }catch(err){console.error(err);$('viewStatus').textContent='数据加载失败';$('overview').appendChild(e('div',String(err),'error'));}}
start();
