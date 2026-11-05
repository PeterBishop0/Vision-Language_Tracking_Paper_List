/* VLT Research Atlas — a legible two-level co-authorship map.
   Source of truth: docs/data/graph.json generated from the repository README.
   "Group" means connected component of co-authorship, NOT a lab/institution. */
'use strict';
const $ = id => document.getElementById(id);
const controls = ['search','category','ccf','fromYear','toYear','maxNodes'];
const collator = new Intl.Collator('en', {sensitivity:'base'});
const PALETTE = [
  {main:'#4679E8',soft:'#EAF1FF',ring:'#D6E4FF'},
  {main:'#12A99F',soft:'#E6F8F5',ring:'#CEF1EB'},
  {main:'#9A70DE',soft:'#F3EDFE',ring:'#E5D8FB'},
  {main:'#E49A37',soft:'#FFF5E6',ring:'#FFE5BA'},
  {main:'#EC7791',soft:'#FFF0F3',ring:'#FFDDE7'},
  {main:'#4199B3',soft:'#E7F6FB',ring:'#CAEAF3'},
  {main:'#727F99',soft:'#F1F4F9',ring:'#E2E7F0'},
  {main:'#8EA84A',soft:'#F4F8E9',ring:'#E6EDCF'}
];
let db=null, cy=null, selectedId=null, filteredPapers=[], authorById=new Map();
let viewMode='overview', activeGroupIds=null, currentGroups=[], currentSubset=null;
function el(tag,content='',className='') {const n=document.createElement(tag);n.textContent=content;if(className)n.className=className;return n;}
function addLink(parent,label,url) {const a=el('a',label);if(typeof url==='string'&&/^https?:\/\//.test(url)){a.href=url;a.target='_blank';a.rel='noopener noreferrer';}parent.appendChild(a);return a;}
function initYearOptions(papers) {const years=papers.map(p=>p.year);const min=Math.min(...years),max=Math.max(...years);for(let year=min;year<=max;year++){ $('fromYear').add(new Option(year,year));$('toYear').add(new Option(year,year));}$('fromYear').value=min;$('toYear').value=max;}
function calcFilteredPapers() {const cat=$('category').value,ccf=$('ccf').value,start=Number($('fromYear').value),end=Number($('toYear').value);return db.papers.filter(p=>(!cat||p.categories.includes(cat))&&(!ccf||p.ccf===ccf)&&p.year>=start&&p.year<=end);}
function makeSubset(papers,query) {
  const pids=new Set(papers.map(p=>p.id)),counts=new Map(), collabs=new Map();
  for(const p of papers) for(const id of p.author_ids) counts.set(id,(counts.get(id)||0)+1);
  const weightedEdges=[];
  for(const e of db.edges){const weight=e.paper_ids.filter(id=>pids.has(id)).length;if(!weight)continue;
    weightedEdges.push({source:e.source,target:e.target,weight});
    for(const [a,b] of [[e.source,e.target],[e.target,e.source]]){if(!collabs.has(a))collabs.set(a,[]);collabs.get(a).push({id:b,weight});}
  }
  const candidates=db.authors.filter(a=>counts.has(a.id)).sort((a,b)=>(counts.get(b.id)-counts.get(a.id))||collator.compare(a.name,b.name));
  const cap=Number($('maxNodes').value);let picked=candidates.slice(0,cap);
  const matches=query?candidates.filter(a=>a.name.toLowerCase().includes(query)):[];
  if(query&&matches.length){const ids=new Set(matches.slice(0,12).map(a=>a.id));const around=[];
    for(const a of matches.slice(0,12)) for(const x of collabs.get(a.id)||[]) around.push(x);
    around.sort((a,b)=>b.weight-a.weight || (counts.get(b.id)||0)-(counts.get(a.id)||0));
    for(const x of around) if(ids.size<cap) ids.add(x.id);
    picked=candidates.filter(a=>ids.has(a.id));
  }
  return {counts,collabs,pids,candidates,picked,matches,weightedEdges};
}
function buildGroups(subset) {
  const ids=new Set(subset.picked.map(a=>a.id));const adjacency=new Map([...ids].map(id=>[id,new Set()]));
  for(const e of subset.weightedEdges){if(ids.has(e.source)&&ids.has(e.target)){adjacency.get(e.source).add(e.target);adjacency.get(e.target).add(e.source);}}
  const visited=new Set(),groups=[];
  const score=id=>(subset.counts.get(id)||0)*100 + (subset.collabs.get(id)||[]).reduce((s,e)=>s+e.weight,0);
  for(const id of ids){if(visited.has(id))continue;const members=[],stack=[id];visited.add(id);
    while(stack.length){const x=stack.pop();members.push(x);for(const y of adjacency.get(x)||[])if(!visited.has(y)){visited.add(y);stack.push(y);}}
    members.sort((a,b)=>score(b)-score(a) || collator.compare(authorById.get(a)?.name||'',authorById.get(b)?.name||''));
    const memberSet=new Set(members);const groupPapers=filteredPapers.filter(p=>p.author_ids.some(a=>memberSet.has(a)));
    const unique=new Set(groupPapers.map(p=>p.id));const gEdges=subset.weightedEdges.filter(e=>memberSet.has(e.source)&&memberSet.has(e.target));
    groups.push({members,paperCount:unique.size,edgeCount:gEdges.length,leader:members[0],edges:gEdges});
  }
  groups.sort((a,b)=>b.members.length-a.members.length||b.paperCount-a.paperCount);
  groups.forEach((g,i)=>{g.index=i;g.color=PALETTE[i%PALETTE.length];});
  return groups;
}
function showDetails(id) {
  selectedId=id;const aside=$('details');aside.replaceChildren(el('div','RESEARCHER PROFILE','panel-label'));
  const a=authorById.get(id);
  if(!a){const blank=el('div','','empty-state');blank.append(el('span','◎','empty-icon'),el('strong','选择一个研究人员'),el('p','点击群组卡片，再点击作者节点，查看署名论文与合著关系。'));aside.appendChild(blank);return;}
  const papers=filteredPapers.filter(p=>p.author_ids.includes(a.id)).sort((x,y)=>y.year-x.year);
  const head=el('div','','person-header');const initials=a.name.trim().split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();head.append(el('div',initials,'avatar'),el('h2',a.name,'person-name'));aside.appendChild(head);
  aside.appendChild(el('div','依据 README 作者署名汇总 · 身份尚未消歧','person-sub'));
  const collabs=new Map();for(const p of papers)for(const aid of p.author_ids)if(aid!==id)collabs.set(aid,(collabs.get(aid)||0)+1);
  const metrics=el('div','','person-metrics');for(const [value,label] of [[papers.length,'篇论文'],[collabs.size,'位合著作者']]){const c=el('div');c.append(el('strong',String(value)),el('small',label));metrics.appendChild(c);}aside.appendChild(metrics);
  aside.appendChild(el('div','收录论文','block-title'));
  for(const p of papers){const card=el('div','','paper');addLink(card,p.title,p.paper_url);card.appendChild(el('small',`${p.year} · ${p.venue} · CCF ${p.ccf}`));for(const cat of p.categories)card.appendChild(el('span',cat,'pill'));if(p.code_url){const link=addLink(card,'查看代码 ↗',p.code_url);link.className='code-link';}aside.appendChild(card);}
  if(!papers.length)aside.appendChild(el('div','当前筛选中没有论文','empty'));
  aside.appendChild(el('div','合著作者','block-title'));const box=el('div','','collaborators');
  for(const [aid,n] of [...collabs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20)){const other=authorById.get(aid);if(!other)continue;const b=el('button',`${other.name} · ${n}`);b.type='button';b.onclick=()=>focusAuthor(aid);box.appendChild(b);}aside.appendChild(box);
}
function groupCard(group) {
  const color=group.color,leader=authorById.get(group.leader)?.name||'Unknown';
  const card=el('button','','community-card');card.type='button';card.setAttribute('aria-label',`查看由 ${leader} 等 ${group.members.length} 位作者组成的合著群组`);
  card.style.setProperty('--cluster',color.main);card.style.setProperty('--cluster-soft',color.soft);
  const top=el('div','','community-top');top.append(el('span',`GROUP ${String(group.index+1).padStart(2,'0')}`,'community-id'),el('span',`${group.members.length} AUTHORS`,'community-size'));card.appendChild(top);
  const body=el('div','','community-body');const copy=el('div','','community-copy');copy.append(el('strong',leader),el('span',group.members.length>1?`与 ${group.members.length-1} 位相关作者形成的合著网络`:'独立署名作者'));body.appendChild(copy);
  const bloom=el('div','','community-bloom');const n=Math.min(group.members.length,7);
  for(let i=0;i<n;i++){const dot=el('i','','bloom-node');dot.style.setProperty('--i',i);dot.style.setProperty('--n',Math.max(3,n));if(i===0)dot.classList.add('bloom-core');bloom.appendChild(dot);}body.appendChild(bloom);card.appendChild(body);
  const bottom=el('div','','community-bottom');bottom.append(el('span',`${group.paperCount} 篇收录论文`),el('span',`${group.edgeCount} 组合著关系`),el('b','探索网络  ↗'));card.appendChild(bottom);
  card.onclick=()=>openGroup(group);return card;
}
function renderOverview(){
  destroyCy();viewMode='overview';activeGroupIds=null;
  $('groupOverview').hidden=false;$('cy').hidden=true;
  $('fit').hidden=true;$('backOverview').hidden=true;
  $('graphTitle').textContent='合作群组地图';
  $('graphStatus').textContent=`${filteredPapers.length} 篇论文 · ${currentSubset.candidates.length} 位作者 · 展示 ${currentGroups.length} 个合著群组`;
  $('legendMain').textContent='合著连通群组';$('legendLines').textContent='每个群组可展开';$('legendSelected').textContent='非机构或实验室划分';$('graphTip').textContent='点击群组卡片进入合作网络';
  const wrapper=$('groupOverview');wrapper.replaceChildren();if(!currentGroups.length){wrapper.appendChild(el('div','该筛选条件下暂无作者，请更换条件。','group-empty'));return;}
  const grid=el('div','','community-grid');for(const g of currentGroups)grid.appendChild(groupCard(g));wrapper.appendChild(grid);
  showDetails(null);
}
function destroyCy(){if(cy){cy.destroy();cy=null;}}
function focusAuthor(id){
  const a=authorById.get(id);if(!a)return;
  const found=currentGroups.find(g=>g.members.includes(id));
  if(viewMode!=='network' || (activeGroupIds && !activeGroupIds.has(id))){
    if(found){openGroup(found,id);return;}
    $('search').value=a.name;viewMode='network';activeGroupIds=null;render();return;
  }
  selectedId=id;showDetails(id);if(cy){const n=cy.getElementById(id);if(n&&!n.empty()){
    highlightNode(n);cy.animate({center:{eles:n},zoom:Math.min(1.25,Math.max(.86,cy.zoom()))},{duration:320});
  }}
}
function highlightNode(n){
  if(!cy)return;cy.elements().removeClass('is-selected is-neighbor is-dim related backbone');
  const adjacent=n.connectedEdges(),connected=adjacent.connectedNodes();
  cy.nodes().addClass('is-dim');cy.edges().addClass('is-dim');
  n.removeClass('is-dim').addClass('is-selected');connected.removeClass('is-dim').addClass('is-neighbor');adjacent.removeClass('is-dim').addClass('related');
}
function clearHighlight(){if(!cy)return;cy.elements().removeClass('is-selected is-neighbor is-dim related');}
function computeSpokes(members,counts,edges){
  const score=new Map(members.map(id=>[id,(counts.get(id)||0)*20]));for(const e of edges){score.set(e.source,(score.get(e.source)||0)+e.weight);score.set(e.target,(score.get(e.target)||0)+e.weight);}
  const ordered=[...members].sort((a,b)=>score.get(b)-score.get(a));
  const coord=new Map(),n=ordered.length;const cx=430,cy=365; if(!n)return coord;
  coord.set(ordered[0],{x:cx,y:cy});
  if(n===1)return coord;
  const first=Math.min(7,n-1);
  for(let i=0;i<first;i++){const angle=-Math.PI/2+i*2*Math.PI/first;coord.set(ordered[i+1],{x:cx+178*Math.cos(angle),y:cy+166*Math.sin(angle)});}
  const rest=n-1-first;if(rest){const radX=335,radY=288;for(let i=0;i<rest;i++){const angle=-Math.PI/2+(i+.3)*2*Math.PI/rest;coord.set(ordered[i+1+first],{x:cx+radX*Math.cos(angle),y:cy+radY*Math.sin(angle)});}}
  return coord;
}
function backboneEdges(members,edges){
  // Maximum spanning forest: just enough links to make the structure readable.
  const parent=new Map(members.map(x=>[x,x]));const find=x=>{let a=x;while(parent.get(a)!==a){parent.set(a,parent.get(parent.get(a)));a=parent.get(a);}return a;};
  const result=new Set();for(const e of [...edges].sort((a,b)=>b.weight-a.weight)){
    const x=find(e.source),y=find(e.target);if(x!==y){parent.set(x,y);result.add([e.source,e.target].sort().join('|'));}}
  return result;
}
function openGroup(group,focusId=null){viewMode='network';activeGroupIds=new Set(group.members);selectedId=focusId;drawNetwork(group.members,group,focusId);}
function drawNetwork(members,group,focusId=null){
  destroyCy();$('groupOverview').hidden=true;$('cy').hidden=false;$('fit').hidden=false;$('backOverview').hidden=false;
  const groupMain=authorById.get(group?.leader||members[0])?.name||'研究人员';
  $('graphTitle').textContent=`${groupMain} · 合著网络`;
  $('graphStatus').textContent=`${members.length} 位作者 · ${group?.paperCount||0} 篇论文 · 点击作者突出其全部合著关系`;
  $('legendMain').textContent='作者节点';$('legendLines').textContent='重点合作路径';$('legendSelected').textContent='选中后突出全部相关合著';$('graphTip').textContent='点击节点查看署名与合作作者';
  const memberSet=new Set(members),edges=currentSubset.weightedEdges.filter(e=>memberSet.has(e.source)&&memberSet.has(e.target));
  const positions=computeSpokes(members,currentSubset.counts,edges),backbone=backboneEdges(members,edges);
  const nodes=members.map((id,i)=>({data:{id,label:authorById.get(id)?.name||id,count:currentSubset.counts.get(id)||1,isCore:i===0},position:positions.get(id),grabbable:true}));
  const lines=edges.map(e=>({data:{id:e.source+'_'+e.target,source:e.source,target:e.target,weight:e.weight}}));
  if(typeof cytoscape==='undefined'){$('graphStatus').textContent='图谱组件加载失败，请检查网络。';return;}
  cy=cytoscape({container:$('cy'),elements:[...nodes,...lines],layout:{name:'preset',fit:true,padding:64},minZoom:.25,maxZoom:2.3,wheelSensitivity:.13,
    style:[
      {selector:'node',style:{'background-color':group?.color.main||'#4679E8','border-color':'#ffffff','border-width':3,
        'width':'mapData(count,1,13,27,61)','height':'mapData(count,1,13,27,61)','label':'data(label)',
        'color':'#34445F','font-size':12,'font-weight':600,'text-valign':'bottom','text-margin-y':11,
        'text-wrap':'wrap','text-max-width':'135px','text-background-color':'#ffffff','text-background-opacity':.9,
        'text-background-padding':'4px','text-background-shape':'roundrectangle','overlay-opacity':0}},
      {selector:'node[?isCore]',style:{'background-color':'#2357C4','border-width':5,'border-color':'#D4E1FF','font-size':14,'font-weight':800}},
      {selector:'edge',style:{'width':1.25,'line-color':'#CBD8EA','opacity':.065,'curve-style':'bezier','line-cap':'round','events':'no'}},
      {selector:'edge.backbone',style:{'line-color':'#ADC1E0','width':2.2,'opacity':.53}},
      {selector:'node.is-dim',style:{'opacity':.19,'text-opacity':.1}},
      {selector:'edge.is-dim',style:{'opacity':.025}},
      {selector:'node.is-neighbor',style:{'opacity':1,'border-color':'#F7B96C','border-width':4}},
      {selector:'edge.related',style:{'opacity':.8,'width':'mapData(weight,1,8,2.1,5)','line-color':'#F6A45F','z-index':20}},
      {selector:'node.is-selected',style:{'opacity':1,'background-color':'#FF916C','border-color':'#FFE0CE','border-width':6,'font-size':14,'font-weight':800,'z-index':999}}
    ]
  });
  // The graph contains ALL co-authorship links. The overview shows only a non-misleading
  // minimal connectivity skeleton, and reveals all relevant ties when a person is focused.
  cy.edges().forEach(e=>{if(backbone.has([e.data('source'),e.data('target')].sort().join('|')))e.addClass('backbone');});
  cy.on('tap','node',e=>focusAuthor(e.target.id()));
  cy.on('tap',e=>{if(e.target===cy){selectedId=null;clearHighlight();showDetails(null);}});
  cy.on('mouseover','node',e=>{if(!selectedId)highlightNode(e.target);});
  cy.on('mouseout','node',()=>{if(!selectedId)clearHighlight();});
  if(focusId){const n=cy.getElementById(focusId);if(n&&!n.empty()){highlightNode(n);showDetails(focusId);}}else showDetails(null);
}
function render(){if(!db)return;const query=$('search').value.trim().toLowerCase();filteredPapers=calcFilteredPapers();currentSubset=makeSubset(filteredPapers,query);currentGroups=buildGroups(currentSubset);
  if(query && currentSubset.matches.length){const match=currentSubset.matches[0],cluster=currentGroups.find(g=>g.members.includes(match.id));if(cluster){openGroup(cluster,match.id);return;}}
  if(query&&!currentSubset.matches.length){renderOverview();$('groupOverview').replaceChildren(el('div','未找到匹配的研究人员，请尝试其他英文姓名或缩短关键词。','group-empty'));$('graphStatus').textContent='未找到匹配的研究人员';return;}
  if(viewMode==='network'&&activeGroupIds){const updated=currentGroups.find(g=>g.members.some(id=>activeGroupIds.has(id)));if(updated){openGroup(updated,selectedId&&updated.members.includes(selectedId)?selectedId:null);return;}}
  renderOverview();
}
async function start(){
  try{const res=await fetch('data/graph.json',{cache:'no-store'});if(!res.ok)throw Error(`HTTP ${res.status}`);db=await res.json();authorById=new Map(db.authors.map(a=>[a.id,a]));
    $('statPapers').textContent=db.meta.unique_papers;$('statAuthors').textContent=db.meta.researchers;$('statEdges').textContent=db.meta.coauthorship_edges;
    $('lastBuilt').textContent=`数据来源：README.md · ${db.meta.generated_utc.slice(0,10)} UTC`;initYearOptions(db.papers);
    for(const id of controls){$(id).addEventListener(id==='search'?'input':'change',()=>{if(id!=='search'){$('search').value='';}selectedId=null;viewMode='overview';activeGroupIds=null;render();});}
    $('reset').addEventListener('click',()=>{$('search').value='';$('category').value='';$('ccf').value='';$('fromYear').selectedIndex=0;$('toYear').selectedIndex=$('toYear').options.length-1;$('maxNodes').value='50';selectedId=null;viewMode='overview';activeGroupIds=null;render();});
    $('backOverview').addEventListener('click',()=>{$('search').value='';selectedId=null;renderOverview();});
    $('fit').addEventListener('click',()=>cy?.fit(undefined,55));
    render();
  }catch(e){$('graphStatus').textContent='图谱数据加载失败';$('groupOverview').textContent=`无法读取图谱数据：${e.message}`;console.error(e);}
}
start();
