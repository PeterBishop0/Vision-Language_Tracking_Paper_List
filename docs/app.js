/* VLT Research Atlas — click-to-explore collaboration communities.
 * Coauthorship groups are connected components of actual README-derived edges.
 * Group previews and individual networks are derived from graph.json.
 * A group is NOT an institution or an independently verified laboratory.
 */
'use strict';
const $ = id => document.getElementById(id);
const create = (tag, text = '', className = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
};
const PALETTE = ['#4577f2','#00a79f','#8963dc','#e9a147','#449ec4','#e4799f','#72a264','#6476b6'];
const STATUS = {
  paper_first_affiliation: '论文首页第一单位（已核实）',
  first_author_affiliation: '第一作者署名单位参考',
  first_author_multi_affiliation_unchecked: '第一作者有多个署名单位，顺序待复核',
  corresponding_reference: '通讯作者单位参考（非第一单位）',
  unknown: '机构待核实'
};
let db = null, cy = null, authorById = new Map();
let selectedId = null, selectedInstitution = null, activeRole = 'all';
let shownPapers = [], currentData = null, currentGroup = null, visibleAuthorIds = new Set();
let otherOpen = false, showAllGroups = false;
const cmp = (a,b) => (a || '').localeCompare(b || '', 'en');

function link(parent, label, href, className = '') {
  const el = create('a', label, className);
  if (typeof href === 'string' && /^https?:\/\//.test(href)) {
    el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer';
  }
  parent.appendChild(el);
  return el;
}
function filterPapers() {
  const category=$('category').value, ccf=$('ccf').value;
  const from=Number($('fromYear').value), to=Number($('toYear').value);
  return db.papers.filter(p=>(!category||p.categories.includes(category))&&
    (!ccf||p.ccf===ccf)&&p.year>=from&&p.year<=to&&
    (!selectedInstitution||p.institution_id===selectedInstitution));
}
function authorScore(id, counts, first, corr, degree) {
  return (counts.get(id)||0)*12+(first.get(id)||0)*6+(corr.get(id)||0)*5+Math.min(degree.get(id)||0,10)*.2;
}
function coauthorGraph(papers) {
  const paperIds=new Set(papers.map(p=>p.id));
  const counts=new Map(),first=new Map(),corr=new Map(),adj=new Map(),edges=[];
  for(const p of papers) {
    for(const id of p.author_ids) {counts.set(id,(counts.get(id)||0)+1);if(!adj.has(id))adj.set(id,[]);}
    if(p.first_author_id)first.set(p.first_author_id,(first.get(p.first_author_id)||0)+1);
    for(const id of p.corresponding_author_ids||[])corr.set(id,(corr.get(id)||0)+1);
  }
  for(const e of db.edges) {
    const weight=e.paper_ids.filter(id=>paperIds.has(id)).length;
    if(!weight||!adj.has(e.source)||!adj.has(e.target))continue;
    edges.push({...e,weight});
    adj.get(e.source).push({id:e.target,weight});
    adj.get(e.target).push({id:e.source,weight});
  }
  const degree=new Map([...adj].map(([id,a])=>[id,a.length]));
  const rank=(a,b)=>authorScore(b,counts,first,corr,degree)-authorScore(a,counts,first,corr,degree)||cmp(authorById.get(a)?.name,authorById.get(b)?.name);
  const visited=new Set(),groups=[];
  for(const seed of counts.keys()) {
    if(visited.has(seed))continue;
    const members=[seed];visited.add(seed);
    for(let i=0;i<members.length;i++)for(const edge of adj.get(members[i])||[]) {
      if(!visited.has(edge.id)){visited.add(edge.id);members.push(edge.id);}
    }
    members.sort(rank);
    const memberSet=new Set(members);
    const groupPapers=papers.filter(p=>p.author_ids.some(id=>memberSet.has(id)));
    groups.push({key:members[0],ids:members,idSet:memberSet,papers:groupPapers.length,
      paperIds:groupPapers.map(p=>p.id),score:members.reduce((sum,id)=>sum+authorScore(id,counts,first,corr,degree),0)});
  }
  groups.sort((a,b)=>b.papers-a.papers||b.score-a.score||cmp(authorById.get(a.ids[0])?.name,authorById.get(b.ids[0])?.name));
  return {counts,first,corr,adj,edges,groups,rank};
}
function activeCommunityFor(id) {
  return currentData?.groups.find(g=>g.idSet.has(id))||null;
}
function destroyGraph() {if(cy){cy.destroy();cy=null;}visibleAuthorIds=new Set();}
function tagName(id) {return authorById.get(id)?.name || 'Unknown author';}
function createPreview(group,index) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 132 98');svg.setAttribute('aria-hidden','true');
  const color=PALETTE[index%PALETTE.length];
  const ids=group.ids.slice(0,7), coords=new Map();
  ids.forEach((id,i)=>{const ang=-Math.PI/2+(i-1)*Math.PI*2/Math.max(1,ids.length-1);
    coords.set(id,i===0?[64,49]:[64+34*Math.cos(ang),49+34*Math.sin(ang)]);});
  const retained=new Set(ids), lines=currentData.edges.filter(e=>retained.has(e.source)&&retained.has(e.target));
  // Only actual coauthorship links are drawn, never invented schematic links.
  for(const e of lines){const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    const a=coords.get(e.source),b=coords.get(e.target);
    line.setAttribute('x1',a[0]);line.setAttribute('y1',a[1]);line.setAttribute('x2',b[0]);line.setAttribute('y2',b[1]);
    line.setAttribute('stroke',color);line.setAttribute('stroke-width',Math.min(2.3,1+e.weight*.35));line.setAttribute('opacity','.27');svg.appendChild(line);}
  ids.forEach((id,i)=>{const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');const p=coords.get(id);
    circle.setAttribute('cx',p[0]);circle.setAttribute('cy',p[1]);circle.setAttribute('r',i===0?'11':'5');
    circle.setAttribute('fill',color);circle.setAttribute('stroke','#fff');circle.setAttribute('stroke-width','2');
    circle.setAttribute('opacity',i===0?'1':'.82');svg.appendChild(circle);});
  return svg;
}
function renderOverview() {
  destroyGraph();currentGroup=null;selectedId=null;
  $('overviewBack').hidden=true;$('maxNodesLabel').hidden=true;
  $('zoomIn').hidden=true;$('zoomOut').hidden=true;$('fit').hidden=true;
  $('overview').hidden=false;$('cy').hidden=true;
  $('networkStatus').textContent=`${shownPapers.length} 篇论文 · ${currentData.counts.size} 位作者 · ${currentData.groups.length} 个合作群组`;
  $('institutionFilterLabel').textContent=selectedInstitution
    ?`机构筛选：${db.institutions.find(g=>g.id===selectedInstitution)?.name||'机构'}`
    :'点击群组卡片直接放大，探索真实作者合著关系';
  $('clearInstitution').hidden=!selectedInstitution;
  $('graphInstruction').textContent='点击群组进入作者网络 · 支持姓名搜索直接定位';
  $('graphFootRight').textContent='不必滚轮缩放';
  const overview=$('overview');overview.replaceChildren();
  if(!currentData.groups.length) {overview.append(create('div','当前筛选条件下没有可显示的合作群组。','empty-state'));renderEmpty();return;}
  const summary=create('div','','overview-heading');
  const introduction=create('div');introduction.append(create('span','COLLABORATION COMMUNITIES','overview-kicker'),create('h3','选择一个合作群组'),create('p','先看主要合作群体，再点击进入放大的关系网络。群组由共同署名关系形成，并不代表机构。'));
  summary.append(introduction);overview.append(summary);
  const grid=create('div','','community-grid');overview.append(grid);
  const showCount=showAllGroups?currentData.groups.length:Math.min(currentData.groups.length,6);
  currentData.groups.slice(0,showCount).forEach((group,index)=>{
    const btn=create('button','','community-card');btn.type='button';btn.style.setProperty('--group-color',PALETTE[index%PALETTE.length]);
    btn.setAttribute('aria-label',`打开 ${tagName(group.ids[0])} 等 ${group.ids.length} 位作者的合作网络`);
    const top=create('div','','community-card-top');top.append(create('span',`NETWORK ${String(index+1).padStart(2,'0')}`,'community-number'),create('span',`${group.ids.length} AUTHORS`,'community-author-count'));btn.append(top);
    const content=create('div','','community-content');const text=create('div','','community-copy');
    text.append(create('span','代表作者','community-overline'),create('strong',tagName(group.ids[0]),'community-person'));
    text.append(create('small',group.ids.slice(1,3).map(tagName).join(' · ')||'独立作者节点','community-collab'));
    content.append(text);const preview=create('div','','community-preview');preview.append(createPreview(group,index));content.append(preview);btn.append(content);
    const bottom=create('div','','community-card-bottom');bottom.append(create('span',`${group.papers} 篇论文  ·  ${group.ids.length} 位作者`),create('span','点击查看网络  →','community-action'));btn.append(bottom);
    btn.addEventListener('click',()=>openGroup(group.key));grid.append(btn);
  });
  if(currentData.groups.length>6){const more=create('button',showAllGroups?'收起次要合作群组 ↑':`展开其余 ${currentData.groups.length-6} 个群组 ↓`,'community-more');
    more.type='button';more.addEventListener('click',()=>{showAllGroups=!showAllGroups;renderOverview();});overview.append(more);}
  renderOverviewDetail();
}
function renderOverviewDetail() {
  const panel=$('details');panel.replaceChildren();const wrap=create('div','','overview-detail');
  wrap.append(create('div','HOW TO EXPLORE','detail-label'));
  const mark=create('div','↗','overview-detail-icon');wrap.append(mark);
  wrap.append(create('h3','点击群组，进入放大视图'),create('p','选择左侧的合作群组后，将看到该群组中的真实作者节点和共同署名连线。再点击作者，就能查看代表论文与合作者。'));
  const tip=create('div','','overview-tip');tip.append(create('strong','快捷操作'),create('span','输入作者姓名可直接定位到所属群组；点击机构卡片可查看相应论文形成的合作网络。'));wrap.append(tip);
  panel.append(wrap);
}
function pickMembers(group,limit) {
  // Pick the strongest authors first, but preserve connectivity as much as possible:
  // breadth-first expansion from the representative author, prioritizing stronger neighbors.
  const picked=[],seen=new Set();const queue=[group.ids[0]];seen.add(group.ids[0]);
  for(let i=0;i<queue.length&&picked.length<limit;i++){
    const id=queue[i];picked.push(id);
    const next=(currentData.adj.get(id)||[]).filter(n=>group.idSet.has(n.id)&&!seen.has(n.id))
      .sort((a,b)=>b.weight-a.weight||currentData.rank(a.id,b.id));
    for(const n of next) {seen.add(n.id);queue.push(n.id);}
  }
  if(picked.length<limit)for(const id of group.ids)if(!picked.includes(id)&&picked.length<limit)picked.push(id);
  // A searched/clicked author must never disappear behind the top-N limit.
  if(selectedId&&group.idSet.has(selectedId)&&!picked.includes(selectedId)) {
    if(picked.length>=limit)picked[picked.length-1]=selectedId;
    else picked.push(selectedId);
  }
  return picked;
}
function buildDetailGraph(group) {
  const rawLimit=$('maxNodes').value;
  const limit=rawLimit==='all'?group.ids.length:Number(rawLimit);
  const ids=pickMembers(group,limit),set=new Set(ids),n=ids.length;
  visibleAuthorIds=new Set(ids);
  const counts=currentData.counts,first=currentData.first,corr=currentData.corr;
  const pickedEdges=currentData.edges.filter(e=>set.has(e.source)&&set.has(e.target));
  const color=PALETTE[Math.max(0,currentData.groups.indexOf(group))%PALETTE.length];
  const nodes=ids.map((id,index)=>{
    let radius,angle;
    if(index===0) {radius=0;angle=0;}
    else if(index<=8) {radius=160;angle=-Math.PI/2+2*Math.PI*(index-1)/Math.min(n-1,8);}
    else if(index<=24) {radius=300;angle=-Math.PI/2+2*Math.PI*(index-9)/Math.min(n-9,16);}
    else if(index<=48) {radius=445;angle=-Math.PI/2+2*Math.PI*(index-25)/Math.min(n-25,24);}
    else {const ring=Math.floor((index-49)/32);radius=600+ring*145;angle=-Math.PI/2+2*Math.PI*((index-49)%32)/32;}
    const x=radius*Math.cos(angle),y=radius*Math.sin(angle);
    const count=counts.get(id)||1;
    const showLabel=n<=36||index<24||count>=3;
    return {data:{id,label:showLabel?tagName(id):'',fullName:tagName(id),count,first:first.get(id)||0,corresponding:corr.get(id)||0,
      color,core:index===0},position:{x,y},classes:(index===0?'representative ':'')+(first.has(id)?'firstAuthor ':'')};
  });
  // Initially show strong, readable edges. All real links become visible when an author is selected.
  const edges=pickedEdges.map(e=>({data:{id:e.source+'_'+e.target,source:e.source,target:e.target,weight:e.weight}}));
  return {nodes,edges};
}
function clearHighlights() {
  if(!cy)return;
  cy.elements().removeClass('dimmed connected chosen related roleMuted');
  if(activeRole!=='all')cy.nodes().forEach(n=>{
    if(activeRole==='first'&&!n.data('first')||activeRole==='corresponding'&&!n.data('corresponding'))n.addClass('roleMuted');
  });
}
function spotlight(id) {
  if(!cy)return;const node=cy.getElementById(id);if(node.empty())return;
  clearHighlights();cy.nodes().addClass('dimmed');cy.edges().addClass('dimmed');
  node.removeClass('dimmed roleMuted').addClass('chosen');
  const edges=node.connectedEdges();edges.removeClass('dimmed').addClass('related');
  edges.connectedNodes().removeClass('dimmed').addClass('connected');
}
function fitDetail(animate=true){if(!cy)return;const duration=animate?300:0;cy.animate({fit:{eles:cy.nodes(),padding:48},duration});}
function changeZoom(factor){if(!cy)return;const zoom=Math.min(cy.maxZoom(),Math.max(cy.minZoom(),cy.zoom()*factor));
  cy.animate({zoom:{level:zoom,position:{x:cy.width()/2,y:cy.height()/2}},duration:180});}
function openGroup(groupKey,focusId=null) {
  const group=currentData?.groups.find(g=>g.key===groupKey||g.idSet.has(groupKey));if(!group)return;
  currentGroup=group;selectedId=focusId;renderGroup();
  // On smaller screens bring the enlarged graph into view without a manual zoom gesture.
  if(window.matchMedia('(max-width:850px)').matches)$('network').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderGroup() {
  const group=currentGroup;if(!group)return;
  destroyGraph();$('overview').hidden=true;$('cy').hidden=false;
  $('overviewBack').hidden=false;$('maxNodesLabel').hidden=false;
  $('zoomIn').hidden=false;$('zoomOut').hidden=false;$('fit').hidden=false;
  $('clearInstitution').hidden=!selectedInstitution;
  $('graphInstruction').textContent='点击作者突出真实合作关系 · 使用 ＋／－ 调整视图';
  $('graphFootRight').textContent='点击 ＋／－ 缩放 · 可拖动节点';
  $('networkStatus').textContent=tagName(group.ids[0])+' 等人的合作网络';
  $('institutionFilterLabel').textContent=`${group.papers} 篇论文 · ${group.ids.length} 位相关作者 · 当前展示 ${Math.min(group.ids.length,$('maxNodes').value==='all'?Infinity:Number($('maxNodes').value))} 位`;
  if(typeof cytoscape!=='function'){$('cy').replaceChildren(create('div','关系网络组件加载失败，请检查网络连接。','empty-state'));renderGroupGuide(group);return;}
  const {nodes,edges}=buildDetailGraph(group),maxCount=Math.max(...nodes.map(n=>n.data.count),1);
  cy=cytoscape({container:$('cy'),elements:[...nodes,...edges],layout:{name:'preset',fit:true,padding:48},
    minZoom:.22,maxZoom:3.5,wheelSensitivity:.38,boxSelectionEnabled:false,
    style:[
      {selector:'node',style:{'background-color':'data(color)','width':n=>Math.min(60,27+n.data('count')*4.2),
        'height':n=>Math.min(60,27+n.data('count')*4.2),'border-width':4,'border-color':'#fff',
        'label':'data(label)','color':'#334b6a','font-size':12,'font-weight':700,'text-valign':'bottom',
        'text-margin-y':10,'text-wrap':'wrap','text-max-width':'120px','text-background-color':'#fff',
        'text-background-opacity':.94,'text-background-padding':'3px'}},
      {selector:'node.representative',style:{'width':65,'height':65,'border-width':6,'border-color':'#dce8ff','font-size':14,'font-weight':800,
        'color':'#1c3c76','label':'data(fullName)'}},
      {selector:'edge',style:{'line-color':'#b0c4df','width':e=>Math.min(3.2,1.1+e.data('weight')*.55),
        'opacity':.30,'curve-style':'bezier'}},
      {selector:'node.roleMuted',style:{'opacity':.22,'text-opacity':.15}},
      {selector:'node.dimmed',style:{'opacity':.16,'text-opacity':.11}},
      {selector:'edge.dimmed',style:{'opacity':.025}},
      {selector:'node.connected',style:{'opacity':1,'border-color':'#cbdcff','border-width':4}},
      {selector:'node.chosen',style:{'background-color':'#fa985c','border-color':'#ffe4ce','border-width':7,
        'opacity':1,'color':'#a65c2e','label':'data(fullName)','font-size':14,'font-weight':800,'z-index':100}},
      {selector:'edge.related',style:{'line-color':'#ea9366','width':e=>Math.min(5,2.1+e.data('weight')*.6),
        'opacity':.82,'z-index':30}}
    ]});
  cy.on('tap','node',ev=>{selectedId=ev.target.id();spotlight(selectedId);renderDetail(selectedId);});
  cy.on('tap',ev=>{if(ev.target===cy){selectedId=null;clearHighlights();renderGroupGuide(group);}});
  cy.on('mouseover','node',ev=>{if(!selectedId)spotlight(ev.target.id());});
  cy.on('mouseout','node',()=>{if(!selectedId)clearHighlights();});
  // Fit is calculated from the selected community only, never the entire dataset.
  requestAnimationFrame(()=>{if(cy){cy.resize();cy.fit(cy.nodes(),46);}});
  if(selectedId&&visibleAuthorIds.has(selectedId)) {spotlight(selectedId);renderDetail(selectedId);}
  else {selectedId=null;clearHighlights();renderGroupGuide(group);}
}
function showOverview(){currentGroup=null;selectedId=null;renderOverview();}
function renderGroupGuide(group) {
  const panel=$('details');panel.replaceChildren();
  const wrap=create('div','','group-guide');
  wrap.append(create('span','COLLABORATION NETWORK','detail-label'));
  wrap.append(create('div','◉','overview-detail-icon'));
  wrap.append(create('h3',tagName(group.ids[0])+' 等作者'));
  wrap.append(create('p',`这个合作网络包含 ${group.ids.length} 位署名作者、${group.papers} 篇收录论文。点击任一作者可查看完整合著关系和发表论文。`));
  const list=create('div','','group-author-shortcuts');
  for(const id of group.ids.slice(0,7)){const b=create('button',tagName(id),'chip');b.type='button';b.onclick=()=>focusAuthor(id);list.append(b);}
  wrap.append(create('div','快速查看研究者','detail-label'),list);panel.append(wrap);
}
function renderEmpty(){const panel=$('details');panel.replaceChildren();const body=create('div','','empty-detail');
  body.append(create('span','◎','avatar-placeholder'),create('strong','选择一位研究者'),create('p','点击作者节点可查看署名论文、共同作者，以及相关机构信息。'));panel.append(body);}
function renderDetail(id) {
  const a=authorById.get(id),panel=$('details');if(!a){renderEmpty();return;}panel.replaceChildren();
  const papers=shownPapers.filter(p=>p.author_ids.includes(id)).sort((a,b)=>b.year-a.year),partners=new Map();
  for(const p of papers)for(const aid of p.author_ids)if(aid!==id)partners.set(aid,(partners.get(aid)||0)+1);
  const head=create('div','','person-head'),avatar=create('div',a.name.split(/\s+/).slice(0,2).map(x=>x[0]).join(''),'avatar'),intro=create('div');
  intro.append(create('h3',a.name),create('p','Researcher · VLT Co-authorship'));head.append(avatar,intro);panel.append(head);
  const metrics=create('div','','metric-row');for(const [value,name] of [[papers.length,'收录论文'],[partners.size,'共同署名作者']]){
    const card=create('div','','metric');card.append(create('strong',String(value)),create('span',name));metrics.append(card);}panel.append(metrics);
  const lead=papers.filter(p=>p.first_author_id===id).length,corr=papers.filter(p=>(p.corresponding_author_ids||[]).includes(id)).length;
  panel.append(create('div',`一作论文 ${lead} 篇 · 已核实通讯 ${corr} 篇`,'person-note'));
  const inst=[...new Set(papers.filter(p=>p.first_author_id===id).map(p=>p.primary_institution))];
  if(inst.length){panel.append(create('div','第一作者论文主机构（不代表个人现任单位）','detail-label'));const chips=create('div','','chip-list');
    inst.slice(0,6).forEach(n=>chips.append(create('span',n,'chip small')));panel.append(chips);}
  panel.append(create('div','相关论文','detail-label'));
  for(const p of papers.slice(0,15)){const item=create('div','','detail-paper');link(item,p.title,p.paper_url);
    item.append(create('div',`${p.venue} ${p.year} · CCF ${p.ccf}`,'meta'));
    const tags=[];if(p.first_author_id===id)tags.push('第一作者');if((p.corresponding_author_ids||[]).includes(id))tags.push('通讯作者');
    if(tags.length)item.append(create('div',tags.join(' / '),'source-indicator'));
    item.append(create('div',`${p.primary_institution} · ${STATUS[p.primary_status]||'单位待核实'}`,'source-indicator'));
    if(p.primary_evidence_url)link(item,'机构依据 ↗',p.primary_evidence_url,'source-indicator');panel.append(item);}
  panel.append(create('div','主要合著作者','detail-label'));const collabs=create('div','','chip-list');
  for(const [aid,n] of [...partners].sort((a,b)=>b[1]-a[1]).slice(0,12)){
    const btn=create('button',`${tagName(aid)} · ${n}`,'chip');btn.type='button';btn.onclick=()=>focusAuthor(aid);collabs.append(btn);}
  panel.append(collabs);
}
function focusAuthor(id){
  if(!authorById.has(id))return;
  if(!currentData?.counts.has(id)){selectedInstitution=null;$('search').value='';prepareGraphData();}
  const group=activeCommunityFor(id);if(!group)return;
  if(currentGroup!==group)openGroup(group.key,id);
  else if(!visibleAuthorIds.has(id)){
    // Show a larger group subset if possible; if the author is still absent,
    // change to the complete group before attempting to focus.
    $('maxNodes').value='all';selectedId=id;renderGroup();
  } else {selectedId=id;spotlight(id);renderDetail(id);}
  if(cy&&visibleAuthorIds.has(id)){
    const node=cy.getElementById(id);const z=Math.min(1.65,Math.max(cy.zoom(),.8));
    cy.animate({zoom:{level:z,position:node.position()},duration:260});
  }
  document.getElementById('network').scrollIntoView({behavior:'smooth',block:'start'});
}
function prepareGraphData(){
  shownPapers=filterPapers();currentData=coauthorGraph(shownPapers);
  const q=$('search').value.trim().toLowerCase();
  if(q){const found=[...currentData.counts.keys()].filter(id=>tagName(id).toLowerCase().includes(q)).sort(currentData.rank);
    if(found.length){openGroup(activeCommunityFor(found[0]).key,found[0]);return;}
    renderOverview();$('networkStatus').textContent=`未找到“${$('search').value.trim()}”对应的作者`;
    const host=$('overview');host.replaceChildren(create('div','没有匹配到研究者，请更换姓名或筛选条件。','empty-state'));return;
  }
  renderOverview();
}
function renderInstitutions(){
  const category=$('category').value,ccf=$('ccf').value,from=Number($('fromYear').value),to=Number($('toYear').value);
  const papers=db.papers.filter(p=>(!category||p.categories.includes(category))&&(!ccf||p.ccf===ccf)&&p.year>=from&&p.year<=to);
  const groups=db.institutions.map(g=>({...g,papers:papers.filter(p=>p.institution_id===g.id)}))
    .filter(g=>g.papers.length).sort((a,b)=>b.papers.length-a.papers.length||cmp(a.name,b.name));
  const major=groups.filter(g=>g.papers.length>=2&&g.id!=='__unknown__');
  const minor=groups.filter(g=>g.papers.length===1&&g.id!=='__unknown__');
  const unknown=groups.filter(g=>g.id==='__unknown__');
  $('institutionStatus').textContent=`${major.length} 个主要机构 · ${minor.length} 个单篇机构`;
  const cards=$('institutionCards');cards.replaceChildren();
  if(!major.length)cards.append(create('div','当前范围内暂无收录 2 篇及以上论文的机构。','empty-state'));
  for(const [i,g] of major.entries()){
    const btn=create('button','','institution-card'+(selectedInstitution===g.id?' active':''));btn.type='button';
    btn.append(create('span',`INSTITUTION  ${String(i+1).padStart(2,'0')}`,'institute-kicker'),create('div',g.name,'institute-name'));
    btn.append(create('div','第一作者：'+[...new Set(g.papers.map(p=>p.authors[0]))].slice(0,3).join(' · '),'institute-sub'));
    const bottom=create('div','','bottom');bottom.append(create('span',`${g.papers.length} 篇收录论文`),create('strong','查看合作网络 ↗'));btn.append(bottom);
    btn.onclick=()=>selectInstitution(g.id);cards.append(btn);
  }
  const nUnknown=unknown.reduce((s,g)=>s+g.papers.length,0);
  $('otherTitle').textContent=`其他机构 · ${minor.length} 所`;
  $('otherSubtitle').textContent=`${minor.length} 篇单篇机构论文`+(nUnknown?` · 另有 ${nUnknown} 篇机构待核实`:'');
  const other=$('otherList');other.replaceChildren();
  for(const g of minor){const btn=create('button',g.name,'other-item');btn.type='button';btn.append(create('small','1 篇论文 · 查看合作网络'));btn.onclick=()=>selectInstitution(g.id);other.append(btn);}
  for(const g of unknown){const btn=create('button','机构待核实','other-item');btn.type='button';btn.append(create('small',`${g.papers.length} 篇论文`));btn.onclick=()=>selectInstitution(g.id);other.append(btn);}
  $('toggleOthers').hidden=!other.children.length;other.hidden=!otherOpen;
  $('toggleOthers').setAttribute('aria-expanded',String(otherOpen));$('othersChevron').textContent=otherOpen?'收起 ↑':'展开 ↓';
}
function refresh(){prepareGraphData();renderInstitutions();}
function selectInstitution(id){selectedInstitution=id;selectedId=null;$('search').value='';showAllGroups=false;refresh();
  $('network').scrollIntoView({behavior:'smooth',block:'start'});}
async function init(){
 try{
  const response=await fetch('data/graph.json',{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP ${response.status}`);db=await response.json();
  if(!db.institutions||!db.papers[0]?.primary_status)throw Error('图谱数据不兼容，请运行机构图谱构建脚本。');
  authorById=new Map(db.authors.map(a=>[a.id,a]));
  $('statPapers').textContent=db.meta.unique_papers;
  $('statResearchers').textContent=db.meta.researchers;
  $('statInstitutions').textContent=db.meta.institutions;
  $('lastBuilt').textContent=`README.md · 数据构建 ${db.meta.generated_utc.slice(0,10)} UTC`;
  const years=db.papers.map(p=>p.year),min=Math.min(...years),max=Math.max(...years);
  for(let y=min;y<=max;y++){$('fromYear').append(new Option(String(y),String(y)));$('toYear').append(new Option(String(y),String(y)));}
  $('fromYear').value=String(min);$('toYear').value=String(max);
  for(const id of ['search','ccf','category','fromYear','toYear'])$(id).addEventListener(id==='search'?'input':'change',()=>{selectedId=null;showAllGroups=false;refresh();});
  $('maxNodes').addEventListener('change',()=>{if(currentGroup)renderGroup();});
  document.querySelectorAll('.role-btn').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.role==='all'));
    b.addEventListener('click',()=>{activeRole=b.dataset.role;
      document.querySelectorAll('.role-btn').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});
      clearHighlights();if(selectedId)spotlight(selectedId);});});
  $('overviewBack').addEventListener('click',showOverview);
  $('fit').addEventListener('click',()=>fitDetail(true));
  $('zoomIn').addEventListener('click',()=>changeZoom(1.4));
  $('zoomOut').addEventListener('click',()=>changeZoom(1/1.4));
  $('toggleOthers').addEventListener('click',()=>{otherOpen=!otherOpen;$('otherList').hidden=!otherOpen;
    $('toggleOthers').setAttribute('aria-expanded',String(otherOpen));$('othersChevron').textContent=otherOpen?'收起 ↑':'展开 ↓';});
  $('clearInstitution').addEventListener('click',()=>{selectedInstitution=null;selectedId=null;refresh();});
  $('reset').addEventListener('click',()=>{$('search').value='';$('ccf').value='';$('category').value='';
    $('fromYear').value=String(min);$('toYear').value=String(max);$('maxNodes').value='24';
    selectedInstitution=null;selectedId=null;activeRole='all';showAllGroups=false;
    document.querySelectorAll('.role-btn').forEach(x=>{const on=x.dataset.role==='all';x.classList.toggle('selected',on);x.setAttribute('aria-pressed',String(on));});
    refresh();});
  refresh();
 }catch(err){console.error(err);$('networkStatus').textContent='图谱加载失败';
    $('overview').replaceChildren(create('div',err.message,'empty-state'));}
}
init();
