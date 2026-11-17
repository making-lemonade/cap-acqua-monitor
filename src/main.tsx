import React,{useCallback,useEffect,useMemo,useState} from 'react';
import{createRoot}from'react-dom/client';
import{AreaChart,Area,LineChart,Line,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid,BarChart,Bar}from'recharts';
import{Droplets,MapPinned,Activity,Database,ArrowUpRight,Download,Search,Moon,Sun,ShieldCheck,AlertTriangle,Info,SlidersHorizontal,GitBranch,BrainCircuit,CalendarDays,Network}from'lucide-react';
import MapPanel from './MapPanel';
import MlLab from './MlLab';
import SignalsLab from './SignalsLab';
import './style.css';

type Field={key:string;name:string;unit:string;periods:string[];limits_by_period:Record<string,number|null>};
type Period={id:string;year:number;quarter:number;label:string;count:number;source_rows:number;cities_count:number;parameters_count:number;dates_min:string;dates_max:string;source_json:string;source_csv:string;sha256_json:string;sha256_csv:string;date_format:string};
type Location={lat:number;lng:number};
type Manifest={metadata:{source:string;updated_utc:string;notes:string[]};periods:Period[];cities:string[];fields:Field[];counts:{periods:number;cities:number;parameters:number;observations:number};geography:{locations:Record<string,Location>;source:string;credit:string;license:string}};
type Sample={city:string;date:string;address:string;sample:string;value:number;censored:boolean;status:string};
type History={period:string;city:string;count:number;measured:number;censored:number;avg:number|null;min:number|null;max:number|null;above:number;near:number;unknown:number};
type Tab='overview'|'data'|'method'|'ml'|'signals';
const base=import.meta.env.BASE_URL;
const compact=(n:number)=>n.toLocaleString('it-IT');
const csv=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
const roman=['','I','II','III','IV'];
const periodName=(p:Period)=>roman[p.quarter]+' trim. '+p.year;
const fmt=(n:number)=>n.toLocaleString('it-IT',{maximumFractionDigits:3});
function limitDifference(value:number,censored:boolean,limit:number|null){
 if(limit===null||limit===undefined)return 'Limite numerico non disponibile';
 if(limit===0)return 'Percentuale non applicabile (limite zero)';
 const pct=100*value/limit;
 if(censored)return pct<=100?'< '+fmt(pct)+'% del limite · oltre '+fmt(100-pct)+'% sotto':'< '+fmt(pct)+'% del limite; posizione esatta sconosciuta';
 if(pct>100)return fmt(pct-100)+'% sopra il limite';
 if(pct<100)return fmt(100-pct)+'% sotto il limite';
 return 'Pari al limite';
}
function App(){
 const[manifest,setManifest]=useState<Manifest|null>(null);
 const[periodId,setPeriodId]=useState('');
 const[parameter,setParameter]=useState('');
 const[city,setCity]=useState('Tutti i comuni');
 const[samples,setSamples]=useState<Sample[]>([]);
 const[history,setHistory]=useState<History[]>([]);
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const[query,setQuery]=useState('');
 const[tab,setTab]=useState<Tab>('overview');
 const[dark,setDark]=useState(false);
 const[page,setPage]=useState(0);
 useEffect(()=>{
   let live=true;
   fetch(base+'data/manifest.json').then(r=>{if(!r.ok)throw Error('Manifest storico non disponibile');return r.json()})
     .then((data:Manifest)=>{
       if(!live)return;
       setManifest(data);
       setPeriodId(data.periods[data.periods.length-1]?.id||'');
       const nitrate=data.fields.find(f=>/nitrato.*no3/i.test(f.name)&&f.periods.includes(data.periods[data.periods.length-1]?.id));
       setParameter((nitrate||data.fields.find(f=>f.periods.includes(data.periods[data.periods.length-1]?.id))||data.fields[0])?.key||'');
     }).catch(e=>{if(live)setError(String(e.message))});
   return()=>{live=false};
 },[]);
 useEffect(()=>{
  if(!periodId||!parameter)return;
  const ctrl=new AbortController();setSamples([]);setBusy(true);
  fetch(base+'data/quarters/'+periodId+'/'+parameter+'.json',{signal:ctrl.signal}).then(r=>{
    if(r.status===404)return[];
    if(!r.ok)throw Error('Errore caricamento trimestre');
    return r.json();
  }).then((rows:Sample[])=>{if(!ctrl.signal.aborted)setSamples(rows)}).catch(e=>{
   if(!ctrl.signal.aborted)setError(String(e.message));
  }).finally(()=>{if(!ctrl.signal.aborted)setBusy(false)});
  return()=>ctrl.abort();
 },[periodId,parameter]);
 useEffect(()=>{
  if(!parameter)return;
  const ctrl=new AbortController();setHistory([]);
  fetch(base+'data/trends/'+parameter+'.json',{signal:ctrl.signal}).then(r=>{
    if(!r.ok)throw Error('Storico parametro non disponibile');
    return r.json()
  }).then((x:History[])=>{if(!ctrl.signal.aborted)setHistory(x)}).catch(e=>{
    if(!ctrl.signal.aborted)setError(String(e.message))
  });
  return()=>ctrl.abort();
 },[parameter]);
 const fields=manifest?.fields||[],periods=manifest?.periods||[];
 const field=fields.find(f=>f.key===parameter);
 const period=periods.find(p=>p.id===periodId);
 const filtered=useMemo(()=>samples.filter(s=>city==='Tutti i comuni'||s.city===city),[samples,city]);
 const display=useMemo(()=>filtered.filter(s=>(s.address+' '+s.sample+' '+s.city).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.date.localeCompare(a.date)),[filtered,query]);
 const counts=useMemo(()=>({
   above:filtered.filter(s=>s.status==='above_limit').length,
   near:filtered.filter(s=>s.status==='near_limit').length,
   under:filtered.filter(s=>s.status==='under_limit').length,
   unknown:filtered.filter(s=>s.status==='unknown').length,
 }),[filtered]);
 const citySummary=useMemo(()=>{
  const m=new Map<string,{city:string;n:number;exceed:number;near:number;classified:number}>();
  for(const s of samples){
   const v=m.get(s.city)||{city:s.city,n:0,exceed:0,near:0,classified:0};v.n++;
   if(s.status==='above_limit')v.exceed++;
   if(s.status==='near_limit')v.near++;
   if(s.status!=='unknown')v.classified++;
   m.set(s.city,v);
  }
  return[...m.values()].sort((a,b)=>b.exceed-a.exceed||b.near-a.near||a.city.localeCompare(b.city))
 },[samples]);
 const trend=useMemo(()=>{
  const m=new Map(history.filter(h=>h.city===(city==='Tutti i comuni'?'*':city)).map(h=>[h.period,h]));
  return periods.map(p=>{
   const h=m.get(p.id);
   return {period:periodName(p),id:p.id,avg:h?.avg??null,measured:h?.measured??0,count:h?.count??0,above:h?.above??0};
  });
 },[history,city,periods]);
 const daily=useMemo(()=>{
  const m=new Map<string,{date:string,sum:number,count:number}>();
  for(const s of filtered){
   if(s.censored)continue;
   const d=m.get(s.date)||{date:s.date,sum:0,count:0};d.sum+=s.value;d.count++;m.set(s.date,d)
  }
  return[...m.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({date:x.date,value:+(x.sum/x.count).toFixed(5)}));
 },[filtered]);
 const changeParam=useCallback((key:string)=>{setParameter(key);setPage(0)},[]);
 const changePeriod=useCallback((id:string)=>{setPeriodId(id);setPage(0)},[]);
 function exportCsv(){
  const rows=[['Comune','Data','Indirizzo','Codice campione','Parametro','Unità','Valore','Sotto limite di quantificazione','Stato','Trimestre'].join(';')];
  for(const s of filtered)rows.push([s.city,s.date,s.address,s.sample,field?.name||'',field?.unit||'',s.value,s.censored?'SI':'NO',s.status,periodId].map(csv).join(';'));
  const blob=new Blob(['\ufeff'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='aqua-intelligence-'+periodId+'.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <div className={dark?'app dark':'app'}>
  <aside className="sidebar">
   <div className="brand"><div className="brand-icon"><Droplets size={23}/></div><span>Aqua<span className="brand-light">Intelligence</span><small>OPEN WATER DATA</small></span></div>
   <div className="side-label">WORKSPACE</div>
   <button className={tab==='overview'?'nav active':'nav'} onClick={()=>setTab('overview')}><Activity size={18}/> Dashboard</button>
   <button className={tab==='data'?'nav active':'nav'} onClick={()=>setTab('data')}><Database size={18}/> Esplora dati</button>
   <button className={tab==='signals'?'nav active':'nav'} onClick={()=>setTab('signals')}><Network size={18}/> Segnali & Cluster</button><button className={tab==='ml'?'nav active':'nav'} onClick={()=>setTab('ml')}><BrainCircuit size={18}/> ML Lab</button>
   <button className={tab==='method'?'nav active':'nav'} onClick={()=>setTab('method')}><GitBranch size={18}/> Fonti & pipeline</button>
   <div className="side-bottom"><div className="source-pill"><span className="online-dot"/> OPEN DATA · GRUPPO CAP</div><a href="https://github.com/making-lemonade/cap-acqua-monitor" target="_blank" rel="noreferrer">Source on GitHub <ArrowUpRight size={14}/></a></div>
  </aside>
  <main className="main"><header className="topbar"><div className="crumb">Analytics <span>/</span> {tab==='overview'?'Overview':tab==='data'?'Data explorer':tab==='signals'?'Segnali & Cluster':tab==='ml'?'ML Lab':'Data engineering'}</div><div className="top-actions"><button className="iconbtn" aria-label="Cambia tema" onClick={()=>setDark(x=>!x)}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button><span className="avatar">AI</span></div></header>
  <div className="content">
    <div className="intro"><div><div className="eyebrow">WATER QUALITY INTELLIGENCE · 2024—2026</div><h1>{tab==='overview'?'L’acqua raccontata dai dati.':tab==='data'?'Ogni analisi, senza filtri nascosti.':tab==='signals'?'Scopri i segnali. Esplora le relazioni.':tab==='ml'?'Rileva l’insolito, con metodo.':'Una pipeline trasparente.'}</h1><p>Analisi indipendente dei dati ufficiali Gruppo CAP. Esplora la qualità dell'acqua nei comuni lombardi e confronta periodi, parametri e misurazioni.</p></div><div className="updated">● {manifest?'Dati elaborati '+new Date(manifest.metadata.updated_utc).toLocaleDateString('it-IT'):'Caricamento dati'}</div></div>
    {error&&<div className="notice"><Info size={20}/>{error}</div>}
    {manifest&&<><section className="filters"><div className="filter-title"><SlidersHorizontal size={17}/> Analisi interattiva <span className="filter-hint"> {manifest.counts.periods} trimestri · {manifest.periods[0]?.year}–{manifest.periods[manifest.periods.length-1]?.year}</span></div>
      <div className="filters-row"><label><span>Periodo</span><select value={periodId} onChange={e=>changePeriod(e.target.value)}>{[...periods].reverse().map(p=><option key={p.id} value={p.id}>{roman[p.quarter]} trimestre {p.year}</option>)}</select></label>
      <label><span>Comune</span><select value={city} onChange={e=>{setCity(e.target.value);setPage(0)}}><option>Tutti i comuni</option>{manifest.cities.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="param-filter"><span>Parametro</span><select value={parameter} onChange={e=>changeParam(e.target.value)}>{fields.map(f=><option key={f.key} value={f.key}>{f.name}{f.unit?' · '+f.unit:''}{!f.periods.includes(periodId)?' (non disponibile nel trimestre)':''}</option>)}</select></label>
      <button className="outline" onClick={exportCsv} disabled={busy||!filtered.length}><Download size={16}/> Esporta CSV</button></div>
    </section>
    {tab==='overview'?<>
     <div className="stats">
      <div className="stat"><div className="stat-label">Periodi pubblicati <CalendarDays size={18}/></div><strong>{manifest.counts.periods}</strong><span>Dal {periods[0]?.year} al {periods[periods.length-1]?.year}</span></div>
      <div className="stat"><div className="stat-label">Comuni disponibili <MapPinned size={18}/></div><strong>{compact(manifest.counts.cities)}</strong><span>Su tutta la serie storica</span></div>
      <div className="stat"><div className="stat-label">Analisi del filtro <Activity size={18}/></div><strong>{busy?'…':compact(filtered.length)}</strong><span>{periodName(period!)} · {field?.name||'Parametro'}</span></div>
      <div className="stat"><div className="stat-label">Oltre soglia nel filtro <AlertTriangle size={18}/></div><strong className={counts.above?'red':''}>{busy?'…':counts.above}</strong><span>Secondo i limiti riportati da CAP</span></div>
     </div>
     <div className="analytics-grid">
      <section className="panel chart-panel"><div className="panel-head"><div><h2>Andamento storico · 2024–2026</h2><p>Media trimestrale delle sole misure quantificate · {field?.name} {field?.unit?'('+field.unit+')':''}</p></div><span className="tag">TREND</span></div>
      {trend.some(x=>x.avg!==null)?<div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{left:2,right:18}}><CartesianGrid vertical={false} stroke="#e9edf3"/><XAxis dataKey="period" tick={{fontSize:10}} tickLine={false} axisLine={false} interval="preserveStartEnd"/><YAxis tick={{fontSize:11}} tickLine={false} axisLine={false} width={48}/><Tooltip formatter={(v)=>[Number(v).toLocaleString('it-IT'),'Media trimestrale']}/><Line type="monotone" dataKey="avg" connectNulls={false} stroke="#4388ea" strokeWidth={2.8} dot={{r:3,fill:'#4388ea'}} activeDot={{r:6}}/></LineChart></ResponsiveContainer></div>:<div className="empty">Nessuna misura quantificata per il parametro e il comune selezionati</div>}
      <div className="subnote">Le medie sono pesate per numero di misurazioni quantificate, non rappresentano la concentrazione esatta di ogni punto della rete.</div></section>
      <section className="panel"><div className="panel-head"><div><h2>Indicatori per il periodo</h2><p>{periodName(period!)} · classificazione preliminare</p></div><ShieldCheck size={20}/></div>
      <div className="status-list"><div><span className="status-name"><i className="dot green"/> Sotto soglia CAP</span><b>{counts.under}</b></div><div><span className="status-name"><i className="dot amber"/> Dal 80% della soglia</span><b>{counts.near}</b></div><div><span className="status-name"><i className="dot redbg"/> Sopra soglia CAP</span><b>{counts.above}</b></div><div><span className="status-name"><i className="dot gray"/> Non confrontabili</span><b>{counts.unknown}</b></div></div>
      <div className="subnote"><Info size={15}/> Le soglie sono trascritte dalla fonte, non validate dal progetto come giudizio sanitario. L'80% è soltanto una soglia grafica.</div></section>
     </div>
     <section className="panel"><div className="panel-head"><div><h2>Mappa dei comuni</h2><p>Seleziona un punto per filtrare le analisi; coordinate comunali, non punti di prelievo</p></div><span className="tag">TERRITORIO</span></div>
       {Object.keys(manifest.geography.locations).length?<MapPanel locations={manifest.geography.locations} summary={citySummary} selected={city} onSelect={setCity}/>:<div className="empty">Coordinate non disponibili: nessuna posizione di prelievo viene inventata</div>}
       <div className="map-legend"><span><i className="dot green"/> Sotto soglia</span><span><i className="dot amber"/> Vicino alla soglia</span><span><i className="dot redbg"/> Almeno una misura oltre soglia</span><span><i className="dot gray"/> Non classificabile</span></div>
       <div className="subnote">Geografia: <a href="https://github.com/RP92/comuni-italiani" target="_blank" rel="noreferrer">RP92/comuni-italiani</a> (CC BY 4.0), mappe © OpenStreetMap. La mappa non certifica la potabilità del comune.</div>
     </section>
     <div className="analytics-grid">
       <section className="panel chart-panel"><div className="panel-head"><div><h2>Misure nel trimestre selezionato</h2><p>Media per data · valori sotto quantificazione esclusi</p></div><span className="tag">{periodId}</span></div>
       {daily.length?<div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={daily}><defs><linearGradient id="fillDaily" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f8ee8" stopOpacity=".25"/><stop offset="100%" stopColor="#4f8ee8" stopOpacity="0"/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e9edf3"/><XAxis dataKey="date" tick={{fontSize:10}} tickLine={false} axisLine={false} minTickGap={25}/><YAxis tick={{fontSize:10}} tickLine={false} axisLine={false} width={44}/><Tooltip/><Area type="monotone" dataKey="value" stroke="#4388ea" strokeWidth={2.5} fill="url(#fillDaily)" dot={false}/></AreaChart></ResponsiveContainer></div>:<div className="empty">{busy?'Caricamento…':'Nessun valore quantificato per il filtro corrente'}</div>}</section>
       <section className="panel"><div className="panel-head"><div><h2>Comuni da approfondire</h2><p>Ordinamento per segnalazioni nel parametro selezionato</p></div></div>
        {citySummary.length?<div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={citySummary.slice(0,8)} layout="vertical" margin={{left:5,right:15}}><CartesianGrid horizontal={false} stroke="#edf0f5"/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="city" width={120} tick={{fontSize:10}}/><Tooltip/><Bar dataKey="exceed" name="Oltre soglia CAP" fill="#e35f64" radius={[0,4,4,0]}/><Bar dataKey="near" name="Vicino alla soglia" fill="#e7b15d" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer></div>:<div className="empty">Nessuna misura disponibile</div>}</section>
     </div>
    </>:tab==='data'?<section className="panel"><div className="panel-head"><div><h2>Registro delle misurazioni</h2><p>{compact(display.length)} osservazioni · {field?.name} · {periodName(period!)}</p></div><div className="search"><Search size={16}/><input placeholder="Cerca luogo o campione" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></div></div>
     <div className="table-wrap"><table><thead><tr><th>Comune</th><th>Data</th><th>Indirizzo / campione</th><th>Valore</th><th>Limite CAP</th><th>Rispetto al limite</th><th>Classificazione</th></tr></thead><tbody>{display.slice(page*100,(page+1)*100).map((s,i)=><tr key={page*100+i}><td>{s.city}</td><td>{s.date}</td><td>{s.address||s.sample||'—'}</td><td>{s.censored?'< ':''}{fmt(s.value)} {field?.unit}</td><td>{field?.limits_by_period?.[periodId]===null||field?.limits_by_period?.[periodId]===undefined?'Non disponibile':fmt(field.limits_by_period[periodId]!)} {field?.unit}</td><td>{limitDifference(s.value,s.censored,field?.limits_by_period?.[periodId]??null)}</td><td><span className={'label '+s.status}>{s.status==='above_limit'?'Oltre soglia':s.status==='near_limit'?'Vicino alla soglia':s.status==='under_limit'?'Sotto soglia':'Non verificato'}</span></td></tr>)}</tbody></table></div>
     <div className="pagination"><span>Righe {display.length?1+page*100:0}–{Math.min(display.length,(page+1)*100)} di {compact(display.length)}</span><button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}>Precedenti</button><button onClick={()=>setPage(p=>p+1)} disabled={(page+1)*100>=display.length}>Successive</button></div></section>
    :tab==='signals'?<SignalsLab manifest={manifest} city={city} onCitySelect={setCity}/>:tab==='ml'?<MlLab/>
    :<div className="methods"><section className="panel" style={{gridColumn:'1 / -1'}}><h2>Archivio ufficiale · {periods.length} trimestri</h2><p>Ogni fonte è conservata come copia originale nella directory pubblica e collegata al file pubblicato da CAP. La pipeline mantiene anche l'hash SHA-256 del contenuto scaricato.</p><div className="table-wrap"><table><thead><tr><th>Periodo</th><th>Misurazioni</th><th>Comuni</th><th>JSON originale</th><th>CSV originale</th></tr></thead><tbody>{[...periods].reverse().map(p=><tr key={p.id}><td>{roman[p.quarter]} trimestre {p.year}</td><td>{compact(p.count)}</td><td>{p.cities_count}</td><td><a href={base+'data/raw/'+p.id+'.json'} download>Scarica JSON</a> · <a href={p.source_json} target="_blank" rel="noreferrer">CAP</a></td><td><a href={base+'data/raw/'+p.id+'.csv'} download>Scarica CSV</a> · <a href={p.source_csv} target="_blank" rel="noreferrer">CAP</a></td></tr>)}</tbody></table></div></section>
     <section className="panel"><h2>01 · Acquisizione e tracciabilità</h2><p>22 file sorgenti registrati per i periodi 2024–2026, con rilevamento dei nuovi collegamenti pubblicati sulla pagina ufficiale e copia byte-per-byte dei file originali.</p></section>
     <section className="panel"><h2>02 · Parsing e modellazione</h2><p>Python interpreta JSON non standard e distingue parametri, unità, date, limiti di fonte e misure censurate. I parametri con nomi o unità differenti non vengono fusi impropriamente.</p></section>
     <section className="panel"><h2>03 · Storage e analisi</h2><p>I valori sono archiviati per trimestre e parametro in file statici caricati su richiesta. I trend sono aggregati con medie pesate sui soli valori quantificati.</p></section>
     <section className="panel"><h2>04 · Automazione e AI</h2><p>GitHub Actions esegue ETL, modello ML sperimentale, build TypeScript e distribuzione GitHub Pages senza alcun server o API commerciale. L'AI segnala anomalie statistiche, non rischi sanitari.</p></section>
    </div>}
    </>}
    <footer>Fonte analisi: <a href="https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua" target="_blank" rel="noreferrer">Gruppo CAP, open data acquedotto</a> · Elaborazione indipendente, non affiliata al gestore · Nessuna classificazione è una certificazione di potabilità. <a href="https://github.com/making-lemonade/cap-acqua-monitor" target="_blank" rel="noreferrer">Documentazione e codice</a></footer>
  </div></main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
