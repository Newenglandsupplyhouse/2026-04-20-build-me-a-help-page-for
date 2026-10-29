import sys, json, re
sys.path.insert(0, ".")
from shopify_upload import gql
SC="./"
models=json.load(open(SC+"models.json")); b=open(SC+"program_page.html").read()
REPL="/products/replacement-catalytic-converter-bandit-vermeer-morbark"
def url(br,f): return f"/products/{models[br]['handle']}?variant={models[br]['variant_ids'][f]}" if br in models else REPL
# 1. replace the "Call us — we'll confirm" section with brand order cards
s=b.find('id="nesh-quote"'); s=b.rfind("<section", 0, s); e=b.find("</section>", s)+10
cards="".join(f'''<div class="nesh-oc"><h3>{br.capitalize()}</h3><p class="nesh-oc-sub">D&amp;S rebuild of your {br.capitalize()} converter. New substrates, new gaskets, 1&ndash;2 day turnaround.</p>
<a class="nesh-oc-btn" href="{url(br,'Gas')}">Gas &middot; $1,350</a><a class="nesh-oc-btn alt" href="{url(br,'Diesel')}">Diesel &middot; $1,750</a></div>''' for br in ("bandit","morbark","vermeer"))
cards+=f'''<div class="nesh-oc"><h3>Any other make</h3><p class="nesh-oc-sub">Carlton, Altec, Rayco, Woodsman and more. Same rebuild, same price. Pick any brand option and name your machine in the order notes.</p>
<a class="nesh-oc-btn" href="{REPL}">Gas &middot; $1,350</a><a class="nesh-oc-btn alt" href="{REPL}">Diesel &middot; $1,750</a></div>'''
new_sec=f'''<section id="nesh-order">
    <style>
      #nesh-order .nesh-oc-grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:1.2rem; margin-top:1rem; }}
      #nesh-order .nesh-oc {{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:1.4rem 1.3rem; box-shadow:0 2px 14px rgba(15,72,114,0.06); display:flex; flex-direction:column; }}
      #nesh-order .nesh-oc h3 {{ margin:0 0 .4rem; color:var(--navy); font-size:1.25rem; }}
      #nesh-order .nesh-oc-sub {{ color:var(--muted); font-size:.95rem; margin:0 0 1rem; flex:1; }}
      #nesh-order .nesh-oc-btn {{ display:block; text-align:center; background:var(--amber); color:var(--navy-dark); font-weight:800; text-decoration:none; border-radius:9px; padding:.8rem 1rem; margin-top:.5rem; }}
      #nesh-order .nesh-oc-btn.alt {{ background:var(--navy); color:#fff; }}
      #nesh-order .nesh-oc-btn:hover {{ filter:brightness(1.06); }}
      #nesh-order .nesh-order-fine {{ text-align:center; color:var(--muted); margin:1.2rem 0 0; }}
      @media screen and (max-width:749px) {{ #nesh-order .nesh-oc-grid {{ grid-template-columns:1fr; }} }}
    </style>
    <h2>Pick your brand and order</h2>
    <p class="nesh-sec-sub">Flat pricing for every wood chipper. Choose gas or diesel to match your engine, check out, and we email shipping or drop-off instructions for your core.</p>
    <div class="nesh-oc-grid">{cards}</div>
    <p class="nesh-order-fine">Rather talk it through first? Call <a href="tel:+17747016374">774-701-6374</a>. We rebuild the catalytic converter on any wood chipper.</p>
  </section>'''
b=b[:s]+new_sec+b[e:]
# 2. order line under each brand heading in "Find your exact machine"
def line(br):
    g,d=url(br.lower(),"Gas"),url(br.lower(),"Diesel")
    return f'<p class="nesh-mi-order" style="margin:0 0 .6rem;font-size:.9rem"><a href="{g}" style="font-weight:700;color:var(--navy)">Order gas $1,350</a> &middot; <a href="{d}" style="font-weight:700;color:var(--navy)">Order diesel $1,750</a></p>'
for br in ("Bandit","Morbark","Vermeer","Carlton","Altec","Rayco","Woodsman"):
    b=b.replace(f"<h3>{br}</h3>\n<ul>", f"<h3>{br}</h3>\n{line(br)}\n<ul>",1)
# 3. offer chip + hero note + machines sub text
b=b.replace("<span>Fast quote, any make</span>","<span>Order online, any make</span>")
b=b.replace("We rebuild the catalytic converter for every one of these wood chippers. Don’t see yours? We rebuild any make and model — just <a href=\"tel:+17747016374\">text or call 774-701-6374</a>.",
            "We rebuild the catalytic converter for every one of these wood chippers. Open your machine for details, or order straight from the brand links. Don’t see yours? We rebuild any make and model — <a href=\"#nesh-order\">order above</a> or <a href=\"tel:+17747016374\">call 774-701-6374</a>.")
b=b.replace('<a class="nf-call nf-order" href="/collections/replacement-catalytic-converters-bandit-morbark-vermeer">🛒 Order online</a>','<a class="nf-call nf-order" href="#nesh-order">🛒 Order online</a>')
print("sections after:", re.findall(r"<h2[^>]*>([^<]+)</h2>", b)[:6], "| order lines:", b.count("nesh-mi-order"), "| quote left:", len(re.findall(r"quote", b, flags=re.I)))
r=gql("mutation($id:ID!,$page:PageUpdateInput!){ pageUpdate(id:$id, page:$page){ page{ handle } userErrors{ field message } } }",{"id":"gid://shopify/Page/128355270878","page":{"body":b}})["pageUpdate"]
print("program page:", r["userErrors"] or "updated"); open(SC+"program_page.html","w").write(b)
