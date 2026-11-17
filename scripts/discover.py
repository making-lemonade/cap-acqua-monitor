"""Inspect links to CAP quarterly CSV/JSON sources in the official landing page."""
import html
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser

PAGE="https://www.gruppocap.it/it/cosa-facciamo/qualita-acqua"
class Collect(HTMLParser):
 def __init__(self):super().__init__();self.values=[]
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if v and (".json" in v.lower() or ".csv" in v.lower() or "analisi-202" in v.lower()):
    self.values.append((k,v))

def discover():
 req=urllib.request.Request(PAGE,headers={"User-Agent":"Mozilla/5.0"})
 body=urllib.request.urlopen(req,timeout=60).read().decode("utf-8","replace")
 p=Collect();p.feed(body)
 print("PAGE_BYTES",len(body),"HTML_ATTR_LINKS",len(p.values))
 for k,v in p.values:
  if "acquedotto" in v.lower() or "analisi-202" in v.lower():
   print("CAP_LINK",k,html.unescape(v)[:600])
 for m in list(re.finditer(r"analisi-202[456]",body,re.I))[:5]:
  print("CONTEXT",body[max(0,m.start()-130):m.start()+280].replace("\n"," ")[:410])
if __name__=="__main__":discover()
