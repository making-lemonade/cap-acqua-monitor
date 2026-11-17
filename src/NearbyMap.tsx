import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type NearbyPoint={
 city:string;lat:number;lng:number;distance:number;indicator:string;
 text:string;isAnchor:boolean
};
type Props={points:NearbyPoint[];radiusKm:number;onSelect:(city:string)=>void};
export default function NearbyMap({points,radiusKm,onSelect}:Props){
 const element=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!element.current||!points.length)return;
  const anchor=points.find(p=>p.isAnchor);
  if(!anchor)return;
  // Leaflet vector layers require an initialized map center/zoom.
  // Adding circles before setView() throws _leaflet_pos / layerPointToLatLng
  // and can unmount the entire React app during municipality selection.
  const center:L.LatLngExpression=[anchor.lat,anchor.lng];
  const map=L.map(element.current,{scrollWheelZoom:false,preferCanvas:true}).setView(center,10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
   maxZoom:17,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const area=L.circle(center,{radius:radiusKm*1000,color:'#4285cf',fillColor:'#4388ea',fillOpacity:.045,weight:1.5,dashArray:'6,5'}).addTo(map);
  for(const point of points){
   const alert=point.indicator==='source_above_limit';
   const stat=point.indicator.startsWith('statistical');
   const near=point.indicator==='source_near_limit';
   const marker=L.circleMarker([point.lat,point.lng],{
     radius:point.isAnchor?10:alert?8:7,
     weight:point.isAnchor?3:1.5,color:point.isAnchor?'#1d4d8d':'white',
     fillColor:point.isAnchor?'#4388ea':alert?'#e35f64':near?'#e2ac51':stat?'#886bd6':'#4dbba3',
     fillOpacity:.9
   }).addTo(map);
   const popup=document.createElement('div');
   const bold=document.createElement('strong');bold.textContent=point.city;popup.appendChild(bold);
   const info=document.createElement('div');info.textContent=point.text;popup.appendChild(info);
   marker.bindTooltip(popup,{direction:'top',offset:[0,-8]});
   marker.on('click',()=>onSelect(point.city));
  }
  map.fitBounds(area.getBounds(),{padding:[15,15]});
  const id=setTimeout(()=>map.invalidateSize(),80);
  return()=>{clearTimeout(id);map.remove()};
 },[points,radiusKm,onSelect]);
 return <div className="map-frame neighborhood-map" ref={element} role="region" aria-label="Mappa dei comuni nel raggio selezionato; distanze approssimate in linea d'aria"/>;
}
