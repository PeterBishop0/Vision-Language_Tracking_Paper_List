/* Browser-side visualization. All graph data comes from locally generated graph.json. */
'use strict';
const $ = id => document.getElementById(id);
const controls = ['search','category','ccf','fromYear','toYear','maxNodes'];
let db = null, cy = null, selectedId = null;
let filteredPapers = [], filteredAuthors = [], paperById = new Map(), authorById = new Map();
const collator = new Intl.Collator('en', {sensitivity: 'base'});

function el(tag, content = '', className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}
function addLink(parent, title, url) {
  const a = el('a', title);
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  } else { a.removeAttribute('href'); }
  parent.appendChild(a);
  return a;
}
function initYearOptions(papers) {
  const years = papers.map(p => p.year);
  const min = Math.min(...years), max = Math.max(...years);
  for (const year of Array.from({length:max-min+1}, (_,i)=>min+i)) {
    $('fromYear').appendChild(new Option(String(year), String(year)));
    $('toYear').appendChild(new Option(String(year), String(year)));
  }
  $('fromYear').value = String(min); $('toYear').value = String(max);
}
function calcFilteredPapers() {
  const category = $('category').value, level = $('ccf').value;
  const start = Number($('fromYear').value), end = Number($('toYear').value);
  return db.papers.filter(p => (!category || p.categories.includes(category)) &&
    (!level || p.ccf === level) && p.year >= start && p.year <= end);
}
function makeSubset(papers, query) {
  const pids = new Set(papers.map(p => p.id));
  const counts = new Map(), collabs = new Map();
  for (const p of papers) for (const a of p.author_ids) counts.set(a, (counts.get(a) || 0) + 1);
  for (const edge of db.edges) {
    const weight = edge.paper_ids.filter(id => pids.has(id)).length;
    if (weight) {
      if (!collabs.has(edge.source)) collabs.set(edge.source, []);
      if (!collabs.has(edge.target)) collabs.set(edge.target, []);
      collabs.get(edge.source).push({id:edge.target,weight});
      collabs.get(edge.target).push({id:edge.source,weight});
    }
  }
  let candidates = db.authors.filter(a => counts.has(a.id));
  const sorter = (a,b) => (counts.get(b.id)-counts.get(a.id)) || collator.compare(a.name,b.name);
  candidates.sort(sorter);
  const cap = Number($('maxNodes').value);
  let picked = candidates.slice(0,cap);
  const matches = query ? candidates.filter(a=>a.name.toLowerCase().includes(query)) : [];
  if (query && matches.length) {
    const ids = new Set(matches.slice(0,15).map(a=>a.id));
    let around = [];
    for (const a of matches.slice(0,15)) for (const x of (collabs.get(a.id)||[])) around.push(x);
    around.sort((a,b) => b.weight-a.weight || (counts.get(b.id)||0)-(counts.get(a.id)||0));
    for (const x of around) if (ids.size < cap) ids.add(x.id);
    picked = candidates.filter(a=>ids.has(a.id)).sort(sorter);
  }
  return {pids,counts,collabs,candidates,picked,matches};
}
function showDetails(id) {
  selectedId = id;
  const aside = $('details');
  aside.replaceChildren(el('div','研究人员 / RESEARCHER','panel-title'));
  const a = authorById.get(id);
  if (!a) { aside.appendChild(el('div','请选择图中的作者节点。','empty')); return; }
  let papers = filteredPapers.filter(p=>p.author_ids.includes(a.id)).sort((x,y)=>y.year-x.year);
  aside.appendChild(el('h2', a.name, 'person-name'));
  aside.appendChild(el('div','身份未消歧 · 来源：README 作者署名', 'person-sub'));
  const collaborators = new Map();
  for (const p of papers) for (const aid of p.author_ids) if(aid!==a.id) collaborators.set(aid, (collaborators.get(aid)||0)+1);
  const metrics = el('div','','person-metrics');
  for(const [value,label] of [[papers.length,'论文'],[collaborators.size,'合著作者']]) {
    const c=el('div');c.append(el('strong',String(value)),el('small',label));metrics.appendChild(c);
  }
  aside.appendChild(metrics);
  aside.appendChild(el('div','相关论文','block-title'));
  if (!papers.length) aside.appendChild(el('div','在当前筛选条件下没有论文。','empty'));
  for (const p of papers) {
    const c=el('div','','paper');addLink(c,p.title,p.paper_url);
    const meta=el('small',`${p.year} · ${p.venue} · CCF ${p.ccf}`);
    c.appendChild(meta);
    for(const cat of p.categories) c.appendChild(el('span',cat,'pill'));
    if (p.code_url) {
      const a=addLink(c,'Code ↗',p.code_url);a.style.marginTop='8px';a.style.fontSize='11px';
    }
    aside.appendChild(c);
  }
  aside.appendChild(el('div','主要共同署名作者','block-title'));
  const box=el('div','','collaborators');
  for(const [aid,n] of [...collaborators.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18)){
    const other=authorById.get(aid);if(!other)continue;
    const b=el('button',`${other.name} (${n})`);b.type='button';
    b.onclick=()=>focusAuthor(aid);box.appendChild(b);
  }
  aside.appendChild(box);
}
function focusAuthor(id) {
  selectedId=id;
  const n=cy?.getElementById(id);
  if(n && !n.empty()) {
    cy.nodes().removeClass('selected'); n.addClass('selected');
    cy.animate({fit:{eles:n,padding:135},duration:300});
  } else {
    $('search').value = authorById.get(id)?.name || '';
    render();
  }
  showDetails(id);
}
function render() {
  if (!db) return;
  const query=$('search').value.trim().toLowerCase();
  filteredPapers=calcFilteredPapers();
  const {counts,collabs,candidates,picked,matches}=makeSubset(filteredPapers,query);
  const ids=new Set(picked.map(a=>a.id));
  const nodes=picked.map(a=>({data:{id:a.id,label:a.name,count:counts.get(a.id)}}));
  const pids = new Set(filteredPapers.map(p=>p.id));
  const edges=db.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>{
    const weight=e.paper_ids.filter(id=>pids.has(id)).length;
    return weight?{data:{id:e.source+'-'+e.target,source:e.source,target:e.target,weight}}:null;
  }).filter(Boolean);
  $('graphStatus').textContent = `${filteredPapers.length} 篇论文 · ${candidates.length} 位作者 · 展示 ${nodes.length} 位` + (query&&!matches.length?' · 未匹配到姓名':'');
  if (cy) {cy.destroy();cy=null;}
  if (typeof cytoscape === 'undefined') {
    $('graphStatus').textContent='图谱组件加载失败，请检查网络连接。';
    return;
  }
  cy=cytoscape({container:$('cy'),elements:[...nodes,...edges],
    style:[
      {selector:'node',style:{'label':'data(label)','background-color':'#64b9ff','border-width':1,'border-color':'#acdfff','width':'mapData(count,1,10,20,52)','height':'mapData(count,1,10,20,52)','font-size':11,'text-valign':'bottom','text-margin-y':8,'color':'#d5e4f4','text-background-color':'#0c1a29','text-background-opacity':.88,'text-background-padding':'3px','text-max-width':'120px','text-wrap':'wrap'}},
      {selector:'edge',style:{'width':'mapData(weight,1,8,1,4)','line-color':'#56809a','opacity':.35,'curve-style':'bezier'}},
      {selector:'node.selected',style:{'background-color':'#a1f1d4','border-width':3,'border-color':'#d6ffe9','color':'#fff','z-index':999}},
      {selector:'node:hover',style:{'background-color':'#a1f1d4'}}],
    layout:{name:'cose',animate:false,randomize:false,nodeRepulsion:350000,idealEdgeLength:90,edgeElasticity:70,gravity:.35,numIter:450},
    minZoom:.12,maxZoom:3,wheelSensitivity:.2
  });
  cy.on('tap','node', e => focusAuthor(e.target.id()));
  if (selectedId && ids.has(selectedId)) focusAuthor(selectedId);
  else if (query && matches.length) focusAuthor(matches[0].id);
  else if (!selectedId) showDetails(null);
  else showDetails(selectedId);
}
async function start() {
  try {
    const res=await fetch('data/graph.json', {cache:'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    db=await res.json();
    authorById=new Map(db.authors.map(a=>[a.id,a]));
    paperById=new Map(db.papers.map(p=>[p.id,p]));
    $('statPapers').textContent=db.meta.unique_papers;
    $('statAuthors').textContent=db.meta.researchers;
    $('statEdges').textContent=db.meta.coauthorship_edges;
    $('lastBuilt').textContent=`数据源：README.md · 构建于 ${db.meta.generated_utc.slice(0,10)} (UTC)`;
    initYearOptions(db.papers);
    for(const id of controls) $(id).addEventListener(id==='search'?'input':'change',render);
    $('reset').addEventListener('click',()=>{
      $('search').value='';$('category').value='';$('ccf').value='';
      $('fromYear').selectedIndex=0;$('toYear').selectedIndex=$('toYear').options.length-1;
      $('maxNodes').value='50';selectedId=null;render();
    });
    $('fit').addEventListener('click',()=>cy?.fit(undefined,45));
    render();
  }catch(e){$('graphStatus').textContent='无法读取图谱数据';$('cy').replaceChildren(el('div',`${e.message}。请通过本地 HTTP 服务器预览，或检查 data/graph.json 是否存在。`,'error'));console.error(e);}
}
start();
