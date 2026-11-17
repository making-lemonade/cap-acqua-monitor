import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type CityLocation={lat:number;lng:number};
export type CitySummary={city:string;n:number;exceed:number;near:number;classified:number};
type Props={
 locations:Record<string,CityLocation>;
 summary:CitySummary[];
 selected:string;
 onSelect:(city:string)=>void;
};
export default function MapPanel({locations,summary,selected,onSelect}:Props){
 const element=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!element.current) return;
  const map=L.map(element.current,{scrollWheelZoom:false,zoomControl:true,preferCanvas:true}).setView([45.46,9.03],10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:17,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const info=new Map(summary.map(s=>[s.city,s]));
  const all:L.LatLngExpression[]=[];
  for(const [city,point] of Object.entries(locations)){
    if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng))continue;
    const s=info.get(city);const status=s?.exceed?'alert':s?.near?'near':s?.classified?'ok':'unknown';
    const color=status==='alert'?'#e5676f':status==='near'?'#e3ad56':status==='ok'?'#40b09c':'#a1afc0';
    const selectedHere=city===selected;
    const marker=L.circleMarker([point.lat,point.lng],{
      radius:selectedHere?11:7,
      color:selectedHere?'#153d77':'#fff',
      weight:selectedHere?3:1.7,
      fillColor:color,fillOpacity:.9,
    }).addTo(map);
    const tooltip=document.createElement('div');
    const name=document.createElement('strong');name.textContent=city;tooltip.appendChild(name);
    const details=document.createElement('div');details.textContent=s?String(s.n)+' misurazioni · '+String(s.exceed)+' sopra soglia CAP':'Nessun valore classificabile';
    tooltip.appendChild(details);
    marker.bindTooltip(tooltip,{direction:'top',offset:[0,-8]});
    marker.on('click',()=>onSelect(city));
    all.push([point.lat,point.lng]);
  }
  if(all.length) map.fitBounds(L.latLngBounds(all),{padding:[28,28],maxZoom:10});
  const resize=setTimeout(()=>map.invalidateSize(),100);
  return ()=>{clearTimeout(resize);map.remove()};
 },[locations,summary,selected,onSelect]);
 return <div className="map-frame" ref={element} role="region" aria-label="Mappa indicativa dei comuni; clicca un cerchio per filtrare la dashboard"/>;
}
