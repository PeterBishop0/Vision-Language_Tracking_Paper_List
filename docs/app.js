/* VLT Research Atlas — network-first, institution-overview-second.
   Uses only README-derived coauthorships; never fabricates links or affiliations. */
'use strict';
const $=id=>document.getElementById(id), create=(tag,text='',cls='')=>{const x=document.createElement(tag);x.textContent=text;if(cls)x.className=cls;return x;};
const PALETTE=['#4E7DEE','#10AAA3','#9375E0','#E4A354','#4D9EC6','#DF7F9E','#6E9A61','#7180B2'];
const ROLE={first:'第一作者',cofirst:'共同一作',corresponding:'通讯作者'};
const STATUS={paper_first_affiliation:'论文首页第一单位（已核实）',first_author_affiliation:'第一作者署名单位参考',first_author_multi_affiliation_unchecked:'第一作者有多个署名单位，顺序待复核',corresponding_reference:'通讯作者单位参考（非第一单位）',unknown:'机构待核实'};
let db,cy=null,selectedId=null,selectedInstitution=null,activeRole='all',shownPapers=[],visibleAuthorIds=new Set(),currentData=null,otherOpen=false;
let amap=new Map(),pmap=new Map();
function makeLink(parent,label,url,cls=''){const x=create('a',label,cls);if(typeof url==='string'&&/^https?:\/\//.test(url)){x.href=url;x.target='_blank';x.rel='noopener noreferrer';}parent.append(x);return x;}
function filterPapers(){const cat=$('category').value,ccf=$('ccf').value,start=Number($('fromYear').value),end=Number($('toYear').value);
 return db.papers.filter(p=>(!cat||p.categories.includes(cat))&&(!ccf||p.ccf===ccf)&&p.year>=start&&p.year<=end&&(!selectedInstitution||p.institution_id===selectedInstitution));}
function authorScore(id,counts,first,corr,degrees){return (counts.get(id)||0)*12+(first.get(id)||0)*6+(corr.get(id)||0)*5+Math.min(10,degrees.get(id)||0)*.2;}
function coauthorGraph(papers){const pid=new Set(papers.map(p=>p.id));const counts=new Map(),first=new Map(),corr=new Map(),adj=new Map(),edges=[];
 for(const p of papers){for(const a of p.author_ids){counts.set(a,(counts.get(a)||0)+1);if(!adj.has(a))adj.set(a,[]);}if(p.first_author_id)first.set(p.first_author_id,(first.get(p.first_author_id)||0)+1);for(const a of p.corresponding_author_ids||[])corr.set(a,(corr.get(a)||0)+1);}
 for(const e of db.edges){const weight=e.paper_ids.filter(p=>pid.has(p)).length;if(!weight)continue;edges.push({...e,weight});adj.get(e.source)?.push({id:e.target,weight});adj.get(e.target)?.push({id:e.source,weight});}
 const degree=new Map([...adj].map(([id,es])=>[id,es.length]));
 const rank=(a,b)=>authorScore(b,counts,first,corr,degree)-authorScore(a,counts,first,corr,degree)||((amap.get(a)?.name||'').localeCompare(amap.get(b)?.name||''));
 const seen=new Set(),groups=[];
 for(const id of counts.keys()){if(seen.has(id))continue;const queue=[id],members=[];seen.add(id);for(let k=0;k<queue.length;k++){const v=queue[k];members.push(v);for(const n of adj.get(v)||[]){if(!seen.has(n.id)){seen.add(n.id);queue.push(n.id);}}}members.sort(rank);const gp=new Set();for(const p of papers)if(p.author_ids.some(a=>members.includes(a)))gp.add(p.id);groups.push({ids:members,papers:gp.size,score:members.reduce((s,id)=>s+authorScore(id,counts,first,corr,degree),0)});}
 groups.sort((a,b)=>b.papers-a.papers||b.score-a.score);
 return {counts,first,corr,adj,edges,groups,rank};}
function pickPeople(d,q,limit){let chosen=[];
 if(q){const matches=[...d.counts.keys()].filter(id=>(amap.get(id)?.name||'').toLowerCase().includes(q)).sort(d.rank).slice(0,8);
   const hit=new Set(matches);const neighbors=[];for(const m of matches)for(const n of d.adj.get(m)||[])neighbors.push(n);
   neighbors.sort((a,b)=>b.weight-a.weight||d.rank(a.id,b.id));for(const n of neighbors){if(hit.size>=limit)break;hit.add(n.id);}chosen=[...hit];
   if(!matches.length)return [];
 }else{
   const activeGroups=d.groups.slice(0,Math.min(d.groups.length,8));let level=0;
   while(chosen.length<limit&&activeGroups.some(g=>g.ids[level])){for(const g of activeGroups){if(chosen.length>=limit)break;if(g.ids[level])chosen.push(g.ids[level]);}level++;}
   if(chosen.length<limit){const remaining=[...d.counts.keys()].filter(id=>!chosen.includes(id)).sort(d.rank);chosen.push(...remaining.slice(0,limit-chosen.length));}
 }
 return chosen.sort(d.rank).slice(0,limit);
}
function graphElements(d,ids){const idSet=new Set(ids),sEdges=d.edges.filter(x=>idSet.has(x.source)&&idSet.has(x.target)),neighbors=new Map(ids.map(id=>[id,[]]));
 for(const ed of sEdges){neighbors.get(ed.source).push(ed.target);neighbors.get(ed.target).push(ed.source);}
 const components=[],visited=new Set();for(const id of ids){if(visited.has(id))continue;const q=[id];visited.add(id);for(let k=0;k<q.length;k++)for(const v of neighbors.get(q[k]))if(!visited.has(v)){visited.add(v);q.push(v);}components.push(q.sort(d.rank));}
 components.sort((a,b)=>b.length-a.length||d.rank(a[0],b[0]));
 // A readable clustered preset, rather than a hairball with hundreds of persistent edges.
 const columns=components.length===1?1:components.length<=4?2:3;
 const coords=new Map();components.forEach((comp,ci)=>{const cx=350+(ci%columns)*680,cy=340+Math.floor(ci/columns)*610;
   comp.forEach((id,j)=>{if(j===0){coords.set(id,{x:cx,y:cy});return;}const k=j-1;let idx=k,ring=0;while(idx>=(ring+1)*8){idx-=(ring+1)*8;ring++;}
    const n=(ring+1)*8,radius=82+ring*83,ang=(-Math.PI/2)+idx*2*Math.PI/n+((ring%2)?0.18:0);
    coords.set(id,{x:cx+radius*Math.cos(ang),y:cy+radius*Math.sin(ang)});});});
 const cmap=new Map();components.forEach((comp,i)=>comp.forEach(id=>cmap.set(id,i)));
 // Keep a maximum-weight spanning forest as the visible baseline; retain all
 // real edges for the clicked author's full collaboration neighborhood.
 const root=new Map(ids.map(id=>[id,id]));const find=x=>{let y=x;while(root.get(y)!==y){y=root.get(y);}return y;};
 const visible=new Set();for(const ed of sEdges.slice().sort((a,b)=>b.weight-a.weight)){const a=find(ed.source),b=find(ed.target);if(a!==b){root.set(a,b);visible.add([ed.source,ed.target].sort().join('|'));}}
 const nodes=ids.map(id=>{const g=cmap.get(id),c=d.counts.get(id)||1,f=d.first.get(id)||0,co=d.corr.get(id)||0,group=components[g];
   const label=(group.indexOf(id)<2||c>=3)?amap.get(id)?.name||id:'';
   return {data:{id,label,fullName:amap.get(id)?.name||id,count:c,first:f,corresponding:co,color:PALETTE[g%PALETTE.length]},position:coords.get(id),classes:(f?'firstAuthor ':'')+(co?'correspondingAuthor':'')};});
 const edgeElems=sEdges.map(e=>({data:{id:e.source+'_'+e.target,source:e.source,target:e.target,weight:e.weight},classes:visible.has([e.source,e.target].sort().join('|'))?'backbone':''}));
 return {elements:[...nodes,...edgeElems],components};}
function clearHighlights(){if(!cy)return;cy.elements().removeClass('dimmed connected chosen related roleMuted');if(activeRole!=='all'){cy.nodes().forEach(n=>{if(activeRole==='first'&&!n.data('first')||activeRole==='corresponding'&&!n.data('corresponding'))n.addClass('roleMuted');});}}
function spotlight(id){if(!cy)return;const node=cy.getElementById(id);if(node.empty())return;clearHighlights();cy.nodes().addClass('dimmed');cy.edges().addClass('dimmed');const edges=node.connectedEdges(),neighbors=edges.connectedNodes();node.removeClass('dimmed roleMuted').addClass('chosen');neighbors.removeClass('dimmed').addClass('connected');edges.removeClass('dimmed').addClass('related');}
function renderGraph(){shownPapers=filterPapers();const d=coauthorGraph(shownPapers),q=$('search').value.trim().toLowerCase(),ids=pickPeople(d,q,Number($('maxNodes').value));visibleAuthorIds=new Set(ids);currentData=d;
 $('networkStatus').textContent=`${shownPapers.length} 篇论文 · ${d.counts.size} 位作者 · 当前展示 ${ids.length} 位`;
 $('institutionFilterLabel').textContent=selectedInstitution?`已聚焦：${db.institutions.find(g=>g.id===selectedInstitution)?.name||'机构'}`:'展示主要合作社群，点击研究者查看完整相关连线';
 $('clearInstitution').hidden=!selectedInstitution;
 if(cy){cy.destroy();cy=null;}const el=$('cy');el.replaceChildren();
 if(typeof cytoscape!=='function'){el.append(create('div','Cytoscape 加载失败，请检查网络连接。','empty-state'));return;}
 if(!ids.length){el.append(create('div','无匹配研究者，请修改姓名或筛选条件。','empty-state'));renderEmpty();return;}
 const graph=graphElements(d,ids);cy=cytoscape({container:el,elements:graph.elements,layout:{name:'preset',fit:true,padding:62,animate:false},minZoom:.11,maxZoom:2.8,wheelSensitivity:.17,boxSelectionEnabled:false,style:[
  {selector:'node',style:{'background-color':'data(color)','width':'mapData(count,1,13,20,46)','height':'mapData(count,1,13,20,46)','border-color':'#fff','border-width':3,'label':'data(label)','color':'#415b82','font-size':11,'font-weight':700,'text-valign':'bottom','text-margin-y':9,'text-wrap':'wrap','text-max-width':'115px','text-background-color':'#fff','text-background-opacity':.89,'text-background-padding':'3px'}},
  {selector:'node.firstAuthor',style:{'border-width':4,'border-color':'#c8d9fd'}},
  {selector:'edge',style:{'line-color':'#b4c4db','width':1.2,'opacity':.025,'curve-style':'bezier'}},
  {selector:'edge.backbone',style:{'line-color':'#a8bfdc','width':1.65,'opacity':.29}},
  {selector:'node.roleMuted',style:{'opacity':.17,'text-opacity':.08}},
  {selector:'node.dimmed',style:{'opacity':.16,'text-opacity':.07}},
  {selector:'edge.dimmed',style:{'opacity':.015}},
  {selector:'node.connected',style:{'opacity':1,'border-color':'#bdd3ff','border-width':4}},
  {selector:'node.chosen',style:{'background-color':'#f29b53','border-color':'#ffe5d0','border-width':7,'opacity':1,'color':'#a7662f','label':'data(fullName)','font-size':13,'font-weight':800,'z-index':40}},
  {selector:'edge.related',style:{'line-color':'#eeaa77','width':'mapData(weight,1,9,2,5)','opacity':.76,'z-index':20}},
 ]});
 cy.on('tap','node',ev=>{selectedId=ev.target.id();spotlight(selectedId);renderDetail(selectedId);});
 cy.on('tap',ev=>{if(ev.target===cy){selectedId=null;clearHighlights();renderEmpty();}});
 cy.on('mouseover','node',ev=>{if(!selectedId)spotlight(ev.target.id());});
 cy.on('mouseout','node',()=>{if(!selectedId)clearHighlights();});
 if(selectedId&&visibleAuthorIds.has(selectedId)){spotlight(selectedId);renderDetail(selectedId);}else{selectedId=null;clearHighlights();renderEmpty();}
}
function renderEmpty(){const box=$('details');box.replaceChildren();const body=create('div','','empty-detail');body.append(create('span','◎','avatar-placeholder'),create('strong','选择一位研究者'),create('p','点击作者节点可以查看其署名论文、共同作者，以及相关机构信息。'));box.append(body);}
function renderDetail(id){const a=amap.get(id),panel=$('details');if(!a){renderEmpty();return;}panel.replaceChildren();const authored=shownPapers.filter(p=>p.author_ids.includes(id)).sort((a,b)=>b.year-a.year),partners=new Map();for(const p of authored)for(const aid of p.author_ids)if(aid!==id)partners.set(aid,(partners.get(aid)||0)+1);
 const header=create('div','','person-head'),avatar=create('div',a.name.split(/\s+/).slice(0,2).map(x=>x[0]).join(''),'avatar'),intro=create('div');intro.append(create('h3',a.name),create('p','Researcher · VLT Co-authorship'));header.append(avatar,intro);panel.append(header);
 const metrics=create('div','','metric-row');for(const [v,title] of [[authored.length,'收录论文'],[partners.size,'共同署名作者']]){const m=create('div','','metric');m.append(create('strong',String(v)),create('span',title));metrics.append(m);}panel.append(metrics);
 const lead=authored.filter(p=>p.first_author_id===id).length,corr=authored.filter(p=>(p.corresponding_author_ids||[]).includes(id)).length;
 panel.append(create('div',`一作论文 ${lead} 篇 · 已核实通讯 ${corr} 篇`,'person-note'));
 const institutions=[...new Set(authored.filter(p=>p.first_author_id===id).map(p=>p.primary_institution))];if(institutions.length){panel.append(create('div','第一作者论文主机构（不代表个人现任单位）','detail-label'));const chips=create('div','','chip-list');institutions.slice(0,6).forEach(n=>chips.append(create('span',n,'chip small')));panel.append(chips);}
 panel.append(create('div','相关论文','detail-label'));
 for(const p of authored.slice(0,15)){const wrap=create('div','','detail-paper');makeLink(wrap,p.title,p.paper_url);wrap.append(create('div',`${p.venue} ${p.year} · CCF ${p.ccf}`,'meta'));
   const tags=[];if(p.first_author_id===id)tags.push('第一作者');if((p.corresponding_author_ids||[]).includes(id))tags.push('通讯作者');if(tags.length)wrap.append(create('div',tags.join(' / '),'source-indicator'));
   wrap.append(create('div',`${p.primary_institution} · ${STATUS[p.primary_status]||'单位待核实'}`,'source-indicator'));
   if(p.primary_evidence_url)makeLink(wrap,'机构依据 ↗',p.primary_evidence_url,'source-indicator');panel.append(wrap);}
 panel.append(create('div','主要合著作者','detail-label'));const chipArea=create('div','','chip-list');for(const [aid,num] of [...partners.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)){const btn=create('button',`${amap.get(aid)?.name||aid} · ${num}`,'chip');btn.onclick=()=>focusAuthor(aid);chipArea.append(btn);}panel.append(chipArea);
}
function focusAuthor(id){if(!visibleAuthorIds.has(id)){const author=amap.get(id);if(author){$('search').value=author.name;selectedInstitution=null;renderAll();}}
 selectedId=id;if(cy&&visibleAuthorIds.has(id)){spotlight(id);const node=cy.getElementById(id);cy.animate({center:{eles:node},zoom:Math.min(1.25,Math.max(.70,cy.zoom()))},{duration:240});}renderDetail(id);document.getElementById('network').scrollIntoView({behavior:'smooth',block:'start'});}
function renderInstitutions(){const basePapers=db.papers.filter(p=>{const cat=$('category').value,ccf=$('ccf').value,start=Number($('fromYear').value),end=Number($('toYear').value);return (!cat||p.categories.includes(cat))&&(!ccf||p.ccf===ccf)&&p.year>=start&&p.year<=end;});
 const groups=db.institutions.map(g=>({...g,papers:basePapers.filter(p=>p.institution_id===g.id)})).filter(g=>g.papers.length).sort((a,b)=>b.papers.length-a.papers.length||a.name.localeCompare(b.name));
 const major=groups.filter(g=>g.papers.length>=2&&g.id!=='__unknown__'),minor=groups.filter(g=>g.papers.length===1&&g.id!=='__unknown__'),unknown=groups.filter(g=>g.id==='__unknown__');
 $('institutionStatus').textContent=`${major.length} 个主要机构 · ${minor.length} 个单篇机构`;
 const host=$('institutionCards');host.replaceChildren();if(!major.length)host.append(create('div','当前筛选范围内暂无收录 2 篇及以上的机构。','empty-state'));
 for(const [i,g] of major.entries()){const b=create('button','','institution-card'+(selectedInstitution===g.id?' active':''));b.type='button';b.append(create('span','INSTITUTION  '+String(i+1).padStart(2,'0'),'institute-kicker'),create('div',g.name,'institute-name'));
   const first=[...new Set(g.papers.map(p=>p.authors[0]))].slice(0,3).join(' · ');b.append(create('div','第一作者：'+first,'institute-sub'));
   const bottom=create('div','','bottom');bottom.append(create('span',`${g.papers.length} 篇收录论文`),create('strong','聚焦合作网络 ↗'));b.append(bottom);
   b.onclick=()=>selectInstitution(g.id);host.append(b);}
 const n=minor.length,m=minor.reduce((n,g)=>n+g.papers.length,0),nUnknown=unknown.reduce((n,g)=>n+g.papers.length,0);
 $('otherTitle').textContent=`其他机构 · ${n} 所`; $('otherSubtitle').textContent=`${m} 篇单篇机构论文`+(nUnknown?` · 另有 ${nUnknown} 篇机构待核实`:'');
 const other=$('otherList');other.replaceChildren();for(const g of minor){const b=create('button',g.name,'other-item');b.type='button';b.append(create('small',`${g.papers.length} 篇论文 · 查看合作网络`));b.onclick=()=>selectInstitution(g.id);other.append(b);}
 for(const g of unknown){const b=create('button','机构待核实','other-item');b.type='button';b.append(create('small',`${g.papers.length} 篇论文 · 暂无主机构依据`));b.onclick=()=>selectInstitution(g.id);other.append(b);}
 $('toggleOthers').hidden=!other.children.length;$('otherList').hidden=!otherOpen;$('toggleOthers').setAttribute('aria-expanded',String(otherOpen));$('othersChevron').textContent=otherOpen?'收起 ↑':'展开 ↓';
}
function renderAll(){renderGraph();renderInstitutions();}
function selectInstitution(id){selectedInstitution=id;selectedId=null;$('search').value='';renderAll();document.getElementById('network').scrollIntoView({behavior:'smooth',block:'start'});}
async function init(){try{const r=await fetch('data/graph.json',{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);db=await r.json();if(!db.institutions||!db.papers[0]?.primary_status)throw Error('网站需要新版图谱数据，请运行 Python 数据构建脚本。');amap=new Map(db.authors.map(a=>[a.id,a]));pmap=new Map(db.papers.map(p=>[p.id,p]));
 $('statPapers').textContent=db.meta.unique_papers;$('statResearchers').textContent=db.meta.researchers;$('statInstitutions').textContent=db.meta.institutions;
 $('lastBuilt').textContent=`README.md · 数据构建 ${db.meta.generated_utc.slice(0,10)} UTC`;
 const years=db.papers.map(p=>p.year),min=Math.min(...years),max=Math.max(...years);for(let y=min;y<=max;y++){$('fromYear').append(new Option(String(y),String(y)));$('toYear').append(new Option(String(y),String(y)));}$('fromYear').value=String(min);$('toYear').value=String(max);
 for(const id of ['search','ccf','category','fromYear','toYear','maxNodes'])$(id).addEventListener(id==='search'?'input':'change',()=>{if(id==='search')selectedId=null;renderAll();});
 document.querySelectorAll('.role-btn').forEach(b=>b.addEventListener('click',()=>{activeRole=b.dataset.role;document.querySelectorAll('.role-btn').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});clearHighlights();if(selectedId)spotlight(selectedId);}));
 $('toggleOthers').addEventListener('click',()=>{otherOpen=!otherOpen;$('otherList').hidden=!otherOpen;$('toggleOthers').setAttribute('aria-expanded',String(otherOpen));$('othersChevron').textContent=otherOpen?'收起 ↑':'展开 ↓';});
 $('fit').addEventListener('click',()=>cy?.fit(undefined,60));$('clearInstitution').addEventListener('click',()=>{selectedInstitution=null;selectedId=null;renderAll();});
 $('reset').addEventListener('click',()=>{$('search').value='';$('ccf').value='';$('category').value='';$('fromYear').value=String(min);$('toYear').value=String(max);$('maxNodes').value='48';selectedInstitution=null;selectedId=null;activeRole='all';document.querySelectorAll('.role-btn').forEach(x=>x.classList.toggle('selected',x.dataset.role==='all'));renderAll();});
 renderAll();
 }catch(err){console.error(err);$('networkStatus').textContent='图谱加载失败';$('cy').append(create('div',err.message,'empty-state'));}}
init();
