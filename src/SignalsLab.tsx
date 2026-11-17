import React,{useEffect,useMemo,useState,useCallback,useRef} from 'react';
import{LineChart,Line,ResponsiveContainer,CartesianGrid,XAxis,YAxis,Tooltip,Legend}from'recharts';
import{Activity,AlertTriangle,BrainCircuit,ChevronDown,Info,MapPin,SlidersHorizontal,ShieldAlert}from'lucide-react';
import NearbyMap,{type NearbyPoint} from './NearbyMap';

type Field={key:string;name:string;unit:string;periods:string[];limits_by_period:Record<string,number|null>};
type Period={id:string;year:number;quarter:number;label:string};
type Location={lat:number;lng:number};
export type ClusterManifest={
 fields:Field[];periods:Period[];cities:string[];
 geography:{locations:Record<string,Location>}
};
type Rule={near_limit_fraction:number;statistical_robust_z:number;min_history_quantified:number;default_radius_km:number;neighbor_radius_options_km:number[];pairwise_min_quarters:number};
type Cluster={id:string;label:string;description:string;parameters:string[]};
type Config={version:number;description:string;analysis:Rule;clusters:Cluster[]};
type Statistical={z:number;reference_median:number;history_count:number;direction:'high'|'low';flag:boolean};
type Observation={
 city:string;parameter:string;name:string;unit:string;period:string;date:string;
 address:string;sample:string;samples_same_day:number;
 value:number;raw:string;censored:boolean;limit:number|null;
 limit_raw:string;limit_percent:number|null;status:string;
 indicator:string;statistical:Statistical|null;
};
type Snapshot={latest_period:string;city_files:Record<string,string>;events:Observation[];notes?:string[]};
type CitySnapshot={city:string;latest_period:string;events:Observation[]};
type Trend={period:string;city:string;count:number;measured:number;avg:number|null};
type Props={manifest:ClusterManifest;city:string;onCitySelect:(city:string)=>void};
const format=(n:number,max=2)=>n.toLocaleString('it-IT',{maximumFractionDigits:max});
const normal=(v:string)=>v.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');
const colors=['#4388ea','#1ba798','#a67bdf','#ec935f','#bf5b85','#a2a842','#6a99aa','#d2b455','#7c6fa9','#68b379'];
const all='Tutti i comuni';
function distanceKm(a:Location,b:Location){
 const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLon=(b.lng-a.lng)*r;
 const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function signalGroup(indicator:string){
 if(indicator==='source_above_limit')return'cap_above';
 if(indicator==='source_near_limit')return'cap_near';
 if(indicator==='statistical_high')return'stat_up';
 if(indicator==='statistical_low')return'stat_down';
 return'none';
}
function indicatorLabel(indicator:string){
 if(indicator==='source_above_limit')return'Oltre limite CAP';
 if(indicator==='source_near_limit')return'Vicino al limite';
 if(indicator==='statistical_high')return'Insolitamente alto';
 if(indicator==='statistical_low')return'Insolitamente basso';
 return'Nessun segnale verificato';
}
function badgeClass(indicator:string){
 return indicator==='source_above_limit'?'above_limit':
        indicator==='source_near_limit'?'near_limit':
        indicator.startsWith('statistical')?'stat_label':'under_limit';
}
function valueText(e:Observation){
 if(e.raw && e.censored && /^[<≤]/.test(e.raw.trim()))return e.raw.trim()+' '+e.unit;
 return(e.censored?'< ':'')+format(e.value,5)+' '+e.unit;
}
function limitText(e:Observation){
 if(e.limit===null){
  if(e.limit_raw?.trim())return e.limit_raw+' '+e.unit+' (non confrontabile)';
  return'Non indicato nel file CAP';
 }
 return format(e.limit,5)+' '+e.unit;
}
function percentText(e:Observation){
 if(e.limit===null)return'Non calcolabile: limite numerico assente';
 if(e.limit===0)return'Non applicabile: la soglia CAP è zero';
 if(e.censored){
  const top=100*e.value/e.limit;
  if(top<=100)return'Meno del '+format(top,2)+'% del limite · oltre '+format(Math.max(0,100-top),2)+'% sotto';
  return'Meno del '+format(top,2)+'% del limite · posizione esatta non determinabile';
 }
 const pct=100*e.value/e.limit;
 if(pct>100)return format(pct,2)+'% del limite · '+format(pct-100,2)+'% sopra';
 if(pct<100)return format(pct,2)+'% del limite · '+format(100-pct,2)+'% sotto';
 return'100% del limite · esattamente sulla soglia';
}
function correlation(x:number[],y:number[]):number|null{
 if(x.length<3||y.length!==x.length)return null;
 const n=x.length,ax=x.reduce((a,b)=>a+b,0)/n,ay=y.reduce((a,b)=>a+b,0)/n;
 const dx=x.map(v=>v-ax),dy=y.map(v=>v-ay);
 const denominator=Math.sqrt(dx.reduce((a,b)=>a+b*b,0)*dy.reduce((a,b)=>a+b*b,0));
 if(denominator<=0)return null;
 return dx.reduce((acc,v,i)=>acc+v*dy[i],0)/denominator;
}
export default function SignalsLab({manifest,city,onCitySelect}:Props){
 const[config,setConfig]=useState<Config|null>(null);
 const[snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const[cityDetails,setCityDetails]=useState<Observation[]>([]);
 const[cityBusy,setCityBusy]=useState(false);
 const[cityError,setCityError]=useState('');
 const[detailMode,setDetailMode]=useState<'signals'|'all'>('signals');
 const[showAllCityRows,setShowAllCityRows]=useState(false);
 const cityDetailRef=useRef<HTMLDivElement>(null);
 const clusterPanelRef=useRef<HTMLElement>(null);
 const[error,setError]=useState('');
 const[clusterId,setClusterId]=useState('pfas');
 const[focusKey,setFocusKey]=useState('');
 const[radius,setRadius]=useState(15);
 const[metric,setMetric]=useState<'index'|'limit'>('index');
 const[clusterOnly,setClusterOnly]=useState(false);
 const[showCount,setShowCount]=useState(35);
 const[trends,setTrends]=useState<Record<string,Trend[]>>({});
 const[trendBusy,setTrendBusy]=useState(false);
 const[showPrevious,setShowPrevious]=useState(false);
 useEffect(()=>{
  const ctrl=new AbortController();
  Promise.all([
    fetch(import.meta.env.BASE_URL+'config/clusters.json',{signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error('Configurazione cluster non disponibile');return r.json()}),
    fetch(import.meta.env.BASE_URL+'data/latest_signals.json',{signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error('Riepilogo dei valori recenti non disponibile');return r.json()})
  ]).then(([a,b]:[Config,Snapshot])=>{
    setConfig(a);setSnapshot(b);setRadius(a.analysis.default_radius_km);
  }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e))});
  return()=>ctrl.abort();
 },[]);
 useEffect(()=>{
  const ctrl=new AbortController();
  setCityDetails([]);setCityError('');
  if(city==='Tutti i comuni'||!snapshot){setCityBusy(false);return()=>ctrl.abort()}
  const path=snapshot.city_files?.[city];
  if(!path){setCityBusy(false);setCityError('Nessun dettaglio normalizzato trovato per questo comune.');return()=>ctrl.abort()}
  setCityBusy(true);
  fetch(import.meta.env.BASE_URL+path,{signal:ctrl.signal}).then(r=>{
   if(!r.ok)throw Error('Archivio del comune non disponibile ('+r.status+')');
   return r.json();
  }).then((d:CitySnapshot)=>{
   if(!ctrl.signal.aborted){setCityDetails(d.events);setCityBusy(false)}
  }).catch(e=>{
   if(!ctrl.signal.aborted){setCityError(String(e.message));setCityBusy(false)}
  });
  return()=>ctrl.abort();
 },[city,snapshot]);
 const chosenCluster=useMemo<Cluster|undefined>(()=>clusterId==='singolo'
  ?{id:'singolo',label:'Parametro individuale',description:'Parametro non assegnato a un cluster tematico. Sono disponibili storico, limiti e confronto territoriale senza inventare collegamenti.',parameters:[manifest.fields.find(f=>f.key===focusKey)?.name||'Parametro']}
  :(config?.clusters.find(c=>c.id===clusterId)||config?.clusters[0]),[clusterId,config,manifest.fields,focusKey]);
 const clusterFields=useMemo(()=>{
  if(!chosenCluster)return[];
  if(chosenCluster.id==='singolo')return manifest.fields.filter(f=>f.key===focusKey).slice(0,1);
  const ids=new Set<string>();
  const selection:Field[]=[];
  for(const name of chosenCluster.parameters){
   const candidates=manifest.fields.filter(f=>normal(f.name)===normal(name));
   candidates.sort((a,b)=>b.periods.length-a.periods.length);
   if(candidates[0]&&!ids.has(candidates[0].key)){
    ids.add(candidates[0].key);selection.push(candidates[0]);
   }
  }
  return selection;
 },[manifest.fields,chosenCluster,focusKey]);
 const clusterKeys=useMemo(()=>new Set(clusterFields.map(f=>f.key)),[clusterFields]);
 const activeField=clusterFields.find(f=>f.key===focusKey)||clusterFields[0];
 const currentKey=activeField?.key||'';
 const latestPeriod=snapshot?.latest_period||manifest.periods[manifest.periods.length-1]?.id;
 const events=snapshot?.events||[];
 const newest=useMemo(()=>events.filter(e=>e.period===latestPeriod),[events,latestPeriod]);
 const chosenCityEvents=useMemo(()=>cityDetails.filter(e=>showPrevious||e.period===latestPeriod),[cityDetails,latestPeriod,showPrevious]);
 const citySignals=useMemo(()=>newest.filter(e=>e.city===city),[newest,city]);
 const cityCurrent=useMemo(()=>cityDetails.filter(e=>e.period===latestPeriod),[cityDetails,latestPeriod]);
 const cityDisplay=useMemo(()=>{
  const records=detailMode==='signals'?citySignals:(cityCurrent.length?cityCurrent:cityDetails);
  const statusOrder=(e:Observation)=>e.indicator==='source_above_limit'?0:e.indicator==='source_near_limit'?1:e.indicator.startsWith('statistical')?2:3;
  return [...records].sort((a,b)=>statusOrder(a)-statusOrder(b)||a.name.localeCompare(b.name));
 },[citySignals,cityDetails,cityCurrent,detailMode]);
 const significant=useMemo(()=>{
  let x=newest.filter(e=>e.indicator!=='not_flagged');
  if(city!==all)x=x.filter(e=>e.city===city);
  if(clusterOnly)x=x.filter(e=>clusterKeys.has(e.parameter));
  const rank=(e:Observation)=>signalGroup(e.indicator)==='cap_above'?0:signalGroup(e.indicator)==='cap_near'?1:2;
  return [...x].sort((a,b)=>rank(a)-rank(b)||a.city.localeCompare(b.city)||a.name.localeCompare(b.name))
 },[newest,city,clusterOnly,clusterKeys]);
 const cityRanks=useMemo(()=>{
  const m=new Map<string,{city:string;alerts:number;statistical:number;near:number;total:number}>();
  for(const e of newest){
   const p=m.get(e.city)||{city:e.city,alerts:0,statistical:0,near:0,total:0};
   p.total++;
   if(e.indicator==='source_above_limit')p.alerts++;
   else if(e.indicator==='source_near_limit')p.near++;
   else if(e.indicator.startsWith('statistical'))p.statistical++;
   m.set(e.city,p);
  }
  return [...m.values()].sort((a,b)=>b.alerts-a.alerts||b.statistical-a.statistical||b.near-a.near).filter(x=>x.alerts||x.near||x.statistical);
 },[newest]);
 const selectedObservation=useMemo(()=>{
  if(city===all||!currentKey)return null;
  return cityDetails.find(e=>e.parameter===currentKey)??null;
 },[cityDetails,city,currentKey]);
 useEffect(()=>{
  if(!clusterFields.length)return;
  const controller=new AbortController();
  setTrendBusy(true);
  Promise.all(clusterFields.map(async f=>{
   const r=await fetch(import.meta.env.BASE_URL+'data/trends/'+f.key+'.json',{signal:controller.signal});
   if(!r.ok)return[f.key,[]] as [string,Trend[]];
   return[f.key,await r.json()] as [string,Trend[]];
  })).then(results=>{
   if(!controller.signal.aborted)setTrends(Object.fromEntries(results));
  }).catch(e=>{if(!controller.signal.aborted)setError(String(e))})
    .finally(()=>{if(!controller.signal.aborted)setTrendBusy(false)});
  return()=>controller.abort();
 },[clusterFields]);
 const chartSeries=useMemo(()=>{
  const geokey=city===all?'*':city;
  return clusterFields.map((f,i)=>{
   const arr=(trends[f.key]||[]).filter(h=>h.city===geokey);
   const byPeriod=new Map(arr.map(x=>[x.period,x]));
   const first=manifest.periods.map(p=>byPeriod.get(p.id)?.avg).find((v):v is number=>typeof v==='number'&&v>0);
   const points=manifest.periods.map(p=>{
    const h=byPeriod.get(p.id);
    const avg=h?.avg;
    const lim=f.limits_by_period?.[p.id];
    if(avg===null||avg===undefined||!h?.measured)return null;
    if(metric==='limit')return lim!==null&&lim!==undefined&&lim>0 ? 100*avg/lim : null;
    return first!==undefined&&first>0?100*avg/first:null;
   });
   return{field:f,color:colors[i%colors.length],points};
  });
 },[clusterFields,trends,manifest.periods,metric,city]);
 const graph=useMemo(()=>manifest.periods.map((p,index)=>{
  const value:Record<string,number|string|null>={period:'T'+p.quarter+' '+p.year};
  for(const line of chartSeries)value[line.field.key]=line.points[index];
  return value;
 }),[chartSeries,manifest.periods]);
 const correlations=useMemo(()=>{
  const geo=city===all?'*':city;
  const pairs:{a:string;b:string;r:number;n:number}[]=[];
  for(let i=0;i<clusterFields.length;i++)for(let j=i+1;j<clusterFields.length;j++){
   const f=clusterFields[i],g=clusterFields[j];
   const ma=new Map((trends[f.key]||[]).filter(t=>t.city===geo&&t.avg!==null).map(t=>[t.period,t.avg as number]));
   const mb=new Map((trends[g.key]||[]).filter(t=>t.city===geo&&t.avg!==null).map(t=>[t.period,t.avg as number]));
   const common=[...ma.keys()].filter(p=>mb.has(p));
   if(common.length<(config?.analysis.pairwise_min_quarters||5))continue;
   const a=common.map(p=>ma.get(p)!),b=common.map(p=>mb.get(p)!);
   const r=correlation(a,b);
   if(r!==null)pairs.push({a:f.name,b:g.name,r,n:common.length});
  }
  return pairs.sort((a,b)=>Math.abs(b.r)-Math.abs(a.r)).slice(0,6);
 },[trends,clusterFields,city,config]);
 const nearby=useMemo(()=>{
  if(city===all||!currentKey)return[];
  const origin=manifest.geography.locations[city];
  if(!origin)return[];
  const found=[];
  for(const e of newest){
   if(e.parameter!==currentKey||e.city===city)continue;
   const pos=manifest.geography.locations[e.city];
   if(!pos)continue;
   const distance=distanceKm(origin,pos);
   if(distance<=radius)found.push({e,distance,similar: selectedObservation?.period===latestPeriod?
       signalGroup(e.indicator)===signalGroup(selectedObservation.indicator)&&signalGroup(e.indicator)!=='none':false});
  }
  return found.sort((a,b)=>Number(b.similar)-Number(a.similar)||a.distance-b.distance);
 },[manifest.geography.locations,newest,city,currentKey,radius,selectedObservation,latestPeriod]);
 const mapPoints=useMemo(()=>{
  if(city===all)return[];
  const origin=manifest.geography.locations[city];
  if(!origin)return[];
  const points:NearbyPoint[]=[{city,lat:origin.lat,lng:origin.lng,distance:0,
     indicator:selectedObservation?.indicator||'not_flagged',isAnchor:true,
     text:selectedObservation?valueText(selectedObservation):'Comune di riferimento'}];
  for(const item of nearby){
   const p=manifest.geography.locations[item.e.city];
   points.push({city:item.e.city,lat:p.lat,lng:p.lng,distance:item.distance,
    indicator:item.e.indicator,isAnchor:false,text:valueText(item.e)+' · '+indicatorLabel(item.e.indicator)});
  }
  return points;
 },[manifest.geography.locations,city,nearby,selectedObservation]);
 const chooseParameter=useCallback((e:Observation,scrollToChart=false)=>{
  const suggested=config?.clusters.find(group=>group.parameters.some(name=>normal(name)===normal(e.name)));
  if(suggested){setClusterId(suggested.id);setFocusKey(e.parameter)}
  else {
   // No silent misclassification: a source parameter without a curated group stays ungrouped.
   setClusterId('singolo');setFocusKey(e.parameter);
  }
  if(scrollToChart)requestAnimationFrame(()=>clusterPanelRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
 },[config]);
 const selectCity=useCallback((c:string)=>{
  onCitySelect(c);setClusterOnly(false);setDetailMode('signals');setShowAllCityRows(false);
  const first=newest.find(e=>e.city===c);
  if(first)chooseParameter(first,false);
  if(c!=='Tutti i comuni')requestAnimationFrame(()=>cityDetailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
 },[onCitySelect,newest,chooseParameter]);
 if(error&&!snapshot)return <div className="notice"><Info size={18}/>{error} · i dati precedenti restano accessibili nelle altre sezioni.</div>;
 if(!config||!snapshot)return <section className="panel"><h2>Caricamento degli indicatori recenti…</h2></section>;
 return <div className="signals-lab">
  <div className="notice subtle-note"><Info size={18}/><span>Indicatori descrittivi, non certificazioni di potabilità: i <strong>limiti CAP</strong> provengono dai singoli file originali; le <strong>anomalie statistiche</strong> confrontano i valori quantificati con lo storico dello stesso comune. I cluster sono <strong>tematici e modificabili</strong> nel file JSON.</span></div>
  <div className="stats">
   <div className="stat"><div className="stat-label">Ultimo periodo <Activity size={17}/></div><strong style={{fontSize:23}}>{latestPeriod.replace('-q',' · T')}</strong><span>Ultima campagna CAP disponibile</span></div>
   <div className="stat"><div className="stat-label">Comuni da approfondire <MapPin size={17}/></div><strong>{cityRanks.length}</strong><span>Almeno un segnale recente</span></div>
   <div className="stat"><div className="stat-label">Oltre soglia CAP <ShieldAlert size={17}/></div><strong className="red">{newest.filter(e=>e.indicator==='source_above_limit').length}</strong><span>Risultati selezionati all'ultima data per parametro</span></div>
   <div className="stat"><div className="stat-label">Anomalie statistiche <BrainCircuit size={17}/></div><strong>{newest.filter(e=>e.indicator.startsWith('statistical')).length}</strong><span>Segnali distinti dai limiti CAP</span></div>
  </div>
  <section className="panel">
   <div className="panel-head"><div><h2>Comuni con segnali nell'ultima campagna</h2><p>Ordinati per quantità di parametri da approfondire, non per potabilità</p></div><span className="tag">ULTIMI DATI</span></div>
   <div className="city-chips">{cityRanks.slice(0,20).map(r=><button key={r.city} className={'city-chip '+(r.city===city?'chip-current':'')} onClick={()=>selectCity(r.city)}><b>{r.city}</b><span>{r.alerts} oltre · {r.near} vicini · {r.statistical} statistici</span></button>)}</div>
   {city!==all&&<div className="selected-city-panel" ref={cityDetailRef} id="dettaglio-comune" aria-live="polite">
     <div className="selected-city-header"><div><div className="eyebrow">DETTAGLIO TERRITORIALE · {latestPeriod}</div><h2>{city}</h2><p>Ultime analisi disponibili per parametro. Clicca su un risultato per vedere i grafici del cluster e il confronto con i comuni vicini.</p></div><button type="button" className="outline" onClick={()=>selectCity(all)}>Tutti i comuni</button></div>
     {cityBusy?<div className="empty">Caricamento dei risultati di {city}…</div>:cityError?<div className="notice"><Info size={17}/>{cityError}</div>:<>
      <div className="city-kpis"><span><b>{citySignals.length}</b> segnali nel trimestre più recente</span><span><b>{cityCurrent.length}</b> parametri con dati nel trimestre</span><span><b>{cityDetails.length}</b> parametri con dati storici recenti</span></div>
      <div className="city-detail-tabs"><button type="button" className={detailMode==='signals'?'selected':''} onClick={()=>{setDetailMode('signals');setShowAllCityRows(false)}}>Segnali ({citySignals.length})</button><button type="button" className={detailMode==='all'?'selected':''} onClick={()=>{setDetailMode('all');setShowAllCityRows(false)}}>Tutti i parametri ({cityCurrent.length||cityDetails.length})</button></div>
      {cityDisplay.length?<div className="city-result-grid">{cityDisplay.slice(0,showAllCityRows?cityDisplay.length:12).map(e=><button type="button" className="city-result-card" key={e.city+'-'+e.parameter} onClick={()=>chooseParameter(e,true)}><span className={'label '+badgeClass(e.indicator)}>{indicatorLabel(e.indicator)}</span><b>{e.name}</b><strong>{valueText(e)}</strong><span>Limite CAP: {limitText(e)}</span><small>{percentText(e)}</small><span className="city-card-action">Visualizza storico e comuni vicini →</span></button>)}</div>:<div className="city-no-signals">{detailMode==='signals'?<>Nessuna segnalazione per {city} nell’ultimo trimestre CAP. <button type="button" className="text-action" onClick={()=>setDetailMode('all')}>Visualizza comunque i risultati disponibili</button>.</>:'Nessun parametro disponibile per questo comune nel periodo selezionato.'}</div>}
      {!showAllCityRows&&cityDisplay.length>12&&<button type="button" className="outline show-more" onClick={()=>setShowAllCityRows(true)}>Mostra tutti i {cityDisplay.length} parametri</button>}
      {cityCurrent.length===0&&cityDetails.length>0&&<div className="small-note">Attenzione: per questo comune non risultano misure nell’ultimo trimestre. Le righe mostrate potrebbero riferirsi a trimestri precedenti, come indicato nelle schede di dettaglio.</div>}
     </>}
   </div>}
   <div className="signal-toolbar"><label className="signal-toggle"><input type="checkbox" checked={clusterOnly} onChange={e=>setClusterOnly(e.target.checked)}/> Mostra solo i parametri del cluster selezionato</label><span>{significant.length} segnali {city!==all?'per '+city:'nei comuni monitorati'}</span></div>
   <div className="table-wrap"><table><thead><tr><th>Comune</th><th>Parametro</th><th>Data</th><th>Risultato</th><th>Limite CAP</th><th>% rispetto al limite</th><th>Segnale</th></tr></thead><tbody>{significant.slice(0,showCount).map((e,i)=><tr key={e.city+'|'+e.parameter+'|'+i}><td><button className="text-action" onClick={()=>selectCity(e.city)}>{e.city}</button></td><td>{e.name}</td><td>{e.date}</td><td>{valueText(e)}</td><td>{limitText(e)}</td><td>{percentText(e)}</td><td><span className={'label '+badgeClass(e.indicator)}>{indicatorLabel(e.indicator)}</span></td></tr>)}</tbody></table></div>
   {significant.length===0&&<div className="empty">Nessun segnale tra quelli selezionati. Questo non certifica che tutti i risultati siano nella norma.</div>}
   {showCount<significant.length&&<button className="outline show-more" onClick={()=>setShowCount(v=>v+50)}>Mostra altri segnali ({significant.length-showCount})</button>}
  </section>
  <section className="panel" ref={clusterPanelRef} id="esplora-cluster">
   <div className="panel-head"><div><h2>Cluster tematici selezionati</h2><p>Raggruppamenti di parametri simili per argomento. Le correlazioni fra i loro andamenti vengono calcolate separatamente.</p></div><a className="outline config-link" href="https://github.com/making-lemonade/cap-acqua-monitor/edit/main/public/config/clusters.json" target="_blank" rel="noreferrer">Modifica clusters.json</a></div>
   <div className="cluster-category-scroll" role="group" aria-label="Cluster tematici">{config.clusters.filter(g=>g.id!=='personalizzato').map(g=><button type="button" key={g.id} className={'cluster-pill '+(chosenCluster?.id===g.id?'cluster-pill-active':'')} onClick={()=>{setClusterId(g.id);setFocusKey('')}}>{g.label}</button>)}</div>
   <div className="filters-row cluster-filters"><label>Cluster<select value={chosenCluster?.id||''} onChange={e=>{setClusterId(e.target.value);setFocusKey('')}}>{clusterId==='singolo'&&<option value="singolo">Parametro individuale</option>}{config.clusters.map(c=><option value={c.id} key={c.id}>{c.label}</option>)}</select></label>
    <label>Parametro di riferimento<select value={currentKey} onChange={e=>setFocusKey(e.target.value)}>{clusterFields.map(f=><option key={f.key} value={f.key}>{f.name} · {f.unit}</option>)}</select></label>
    <label>Scala per il confronto<select value={metric} onChange={e=>setMetric(e.target.value as 'index'|'limit')}><option value="index">Indice 100 (inizio serie)</option><option value="limit">% del limite CAP</option></select></label>
   </div>
   <p className="muted-paragraph">{chosenCluster?.description} · {clusterFields.length} parametri disponibili su {chosenCluster?.parameters.length} configurati.</p>
   {chosenCluster&&chosenCluster.parameters.length>clusterFields.length&&<div className="small-note">Alcune voci del cluster non sono presenti con la stessa denominazione nelle sorgenti CAP. Non vengono inventate né abbinate automaticamente.</div>}
   <div className="panel-head" style={{marginTop:25}}><div><h2>Andamento dei parametri del cluster</h2><p>{city===all?'Tutti i comuni (media delle misure quantificate)':city} · {metric==='index'?'100 = prima media trimestrale quantificata positiva':'100% = limite CAP del singolo trimestre'}</p></div></div>
   {trendBusy?<div className="empty">Caricamento delle serie storiche…</div>:chartSeries.some(s=>s.points.some(v=>v!==null))?<div className="chart cluster-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={graph} margin={{top:10,right:20,bottom:10,left:10}}><CartesianGrid vertical={false} stroke="#e9edf3"/><XAxis dataKey="period" tick={{fontSize:10}}/><YAxis tick={{fontSize:11}} width={55}/><Tooltip/><Legend wrapperStyle={{fontSize:11}}/>{chartSeries.map(s=><Line key={s.field.key} type="monotone" connectNulls={false} dataKey={s.field.key} name={s.field.name} stroke={s.color} strokeWidth={2.2} dot={{r:2}} isAnimationActive={false}/>)}</LineChart></ResponsiveContainer></div>:<div className="empty">Serie non comparabili con la scala selezionata.</div>}
   <div className="small-note">Le unità fisiche diverse non sono sovrapposte come se fossero equivalenti. L'indice 100 confronta variazioni relative; la scala % richiede un limite numerico positivo. I periodi senza dato rimangono vuoti. Campionamenti diversi possono influenzare i trend.</div>
   <h2 style={{marginTop:27}}>Associazioni statistiche fra parametri</h2>
   <p className="muted-paragraph">Correlazione di Pearson tra medie trimestrali quantificate, calcolata solo su {config.analysis.pairwise_min_quarters} o più trimestri in comune. Non implica causalità né la stessa origine dell'acqua.</p>
   {correlations.length?<div className="correlation-list">{correlations.map((r,i)=><div className="correlation-item" key={i}><span>{r.a} <b>↔</b> {r.b}</span><strong>r = {format(r.r,2)}</strong><small>{r.n} trimestri</small></div>)}</div>:<div className="small-note">Non ci sono sufficienti medie trimestrali comparabili per stimare una correlazione attendibile.</div>}
  </section>
  <section className="panel">
   <div className="panel-head"><div><h2>Dettaglio del limite e dell'ultimo risultato</h2><p>{currentKey?activeField?.name:'Scegli un parametro'} · la percentuale è calcolata solo con un limite numerico positivo</p></div></div>
   {city===all?<div className="small-note">Seleziona un comune nel filtro principale o nei risultati per vedere valori, limiti e percentuali.</div>:selectedObservation?
    <div className="detail-grid"><div className="detail-tile"><span>Comune e data</span><b>{selectedObservation.city}</b><small>{selectedObservation.date} · {selectedObservation.address||'Punto non specificato'}</small></div><div className="detail-tile"><span>Risultato riportato</span><b>{valueText(selectedObservation)}</b><small>{selectedObservation.censored?'Valore censurato: non è una misura esatta':selectedObservation.samples_same_day>1?'Campione con stato più critico tra '+selectedObservation.samples_same_day+' prelievi del giorno':'Valore quantificato'}</small></div><div className="detail-tile"><span>Limite nella fonte CAP</span><b>{limitText(selectedObservation)}</b><small>Applicabilità normativa non verificata indipendentemente</small></div><div className="detail-tile"><span>Distanza dal limite</span><b>{selectedObservation.limit!==null&&selectedObservation.limit>0&&selectedObservation.limit_percent!==null?(selectedObservation.censored?'< ':'')+format(selectedObservation.limit_percent,2)+'%':'Non calcolabile'}</b><small>{percentText(selectedObservation)}</small></div></div>
     :<div className="small-note">Nessuna misurazione disponibile per questo parametro nel comune selezionato.</div>}
   {city!==all&&chosenCityEvents.length>0&&<><div className="panel-head" style={{marginTop:26}}><div><h2>Altri parametri del cluster nel comune</h2><p>Ultimo dato disponibile per ogni parametro, eventualmente da un trimestre precedente</p></div><label className="signal-toggle"><input type="checkbox" checked={showPrevious} onChange={e=>setShowPrevious(e.target.checked)}/> Includi dati precedenti</label></div><div className="table-wrap"><table><thead><tr><th>Parametro</th><th>Ultima data</th><th>Misura</th><th>Limite CAP</th><th>Confronto</th></tr></thead><tbody>{chosenCityEvents.filter(e=>clusterKeys.has(e.parameter)).map(e=><tr key={e.parameter}><td>{e.name}</td><td>{e.date}</td><td>{valueText(e)}</td><td>{limitText(e)}</td><td>{percentText(e)}</td></tr>)}</tbody></table></div></>}
  </section>
  <section className="panel">
   <div className="panel-head"><div><h2>Segnali simili nei comuni vicini</h2><p>Stesso parametro analitico · ultimo trimestre CAP · distanza geografica approssimata tra i centri comunali</p></div><MapPin size={19}/></div>
   <div className="filters-row"><label>Raggio di ricerca<select value={radius} onChange={e=>setRadius(Number(e.target.value))}>{config.analysis.neighbor_radius_options_km.map(n=><option key={n} value={n}>{n} km</option>)}</select></label><label>Comune di riferimento<select value={city} onChange={e=>selectCity(e.target.value)}><option>{all}</option>{manifest.cities.map(c=><option key={c}>{c}</option>)}</select></label></div>
   {city!==all&&mapPoints.length?<><NearbyMap points={mapPoints} radiusKm={radius} onSelect={selectCity}/><div className="small-note">{nearby.length} comuni con dati recenti sul parametro nel raggio di {radius} km. I cerchi indicano distanze in linea d'aria, non collegamenti tra acquedotti; punti approssimativi da anagrafica comunale.</div>
   <div className="table-wrap"><table><thead><tr><th>Comune vicino</th><th>Distanza</th><th>Ultimo dato</th><th>Limite CAP</th><th>Indicatore</th><th>Confronto con il comune scelto</th></tr></thead><tbody>{nearby.map(item=><tr key={item.e.city}><td><button className="text-action" onClick={()=>selectCity(item.e.city)}>{item.e.city}</button></td><td>{format(item.distance,1)} km</td><td>{valueText(item.e)}</td><td>{limitText(item.e)}</td><td><span className={'label '+badgeClass(item.e.indicator)}>{indicatorLabel(item.e.indicator)}</span></td><td>{item.similar?'Segnale della stessa categoria':'Segnale diverso o non presente'}</td></tr>)}</tbody></table></div>
    </>:<div className="small-note">{city===all?'Seleziona un comune per esplorare il territorio circostante.':'Coordinate comunali non disponibili per questa selezione.'}</div>}
   <div className="subnote"><Info size={15}/> Correlazioni e vicinanza geografica non dimostrano contaminazione condivisa o connessione idraulica. Fonte mappa: OpenStreetMap; coordinate comunali: RP92/ISTAT/Garda Informatica.</div>
  </section>
 </div>;
}
