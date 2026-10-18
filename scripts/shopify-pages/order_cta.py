import sys, json, re, html
sys.path.insert(0, ".")
from shopify_upload import gql
import page_photos as PP   # reuses hero()/card() with disclaimers
SC="./"
pages=json.load(open(SC+"all_pages.json")); models=json.load(open(SC+"models.json"))
REPL="/products/replacement-catalytic-converter-bandit-vermeer-morbark"
PRICE={"Gas":"$1,350","Diesel":"$1,750"}
BTN='display:inline-block;padding:13px 22px;background:#12365f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;margin:0 10px 10px 0'
BTN2='display:inline-block;padding:13px 22px;background:#f0b429;color:#0a3354;border-radius:8px;text-decoration:none;font-weight:800;margin:0 10px 10px 0'
def product_url(brand, fuel):
    if brand in models: return f"/products/{models[brand]['handle']}?variant={models[brand]['variant_ids'][fuel]}"
    return REPL
def machine_name(p):
    t=re.sub(r"\s+(Gas|Diesel)?\s*Catalytic Converter Rebuild$","",p["title"]).strip(); return t
def fuels(p):
    h=p["handle"]; return ["Gas"] if "-gas-" in h else ["Diesel"] if "-diesel-" in h else ["Gas","Diesel"]
def order_section(p, keep_view_all=False):
    name=machine_name(p); fs=fuels(p); b=p["brand"]
    btns="".join(f'<a href="{product_url(b,f)}" style="{BTN if i else BTN2}">Order the {f.lower()} rebuild &middot; {PRICE[f]}</a>' for i,f in enumerate(fs))
    lead = (f"Pick gas or diesel to match the engine in your {html.escape(name)}." if len(fs)==2 else f"Your {html.escape(name)} uses the {fs[0].lower()} rebuild.")
    other = "" if b in models else f' This is the same D&amp;S rebuild we do for Bandit, Morbark and Vermeer; choose any brand option at checkout and tell us your machine in the order notes.'
    return (f'<h2 data-nesh-cta="order">Order your rebuild</h2>\n<p>{lead} Checkout takes a minute, then we email shipping or drop-off instructions for your core. Rebuilt and on its way back in 1&ndash;2 business days, typically.{other}</p>\n'
            f'<p>{btns}</p>\n<p style="color:#555">Questions first? Call <a href="tel:+17747016374">774-701-6374</a>.</p>\n')
def transform(p):
    body=p["body"]; changed=False
    # 1. CTA replacement
    if 'data-nesh-cta="order"' not in body:
        m=re.search(r"<h2[^>]*>Get your quote</h2>", body)
        if m:
            rest=body[m.end():]; cut=min([x for x in (rest.find("<hr"), rest.find("<!-- nesh-call-tracking"), rest.find("<h2")) if x>=0] or [len(rest)])
            body=body[:m.start()]+order_section(p)+rest[cut:]; changed=True
        else:
            m=re.search(r"<h2[^>]*>Request a Fitment Check</h2>", body)
            if m:
                rest=body[m.end():]; cut=rest.find('<p><a href="/collections'); cut=cut if cut>=0 else min([x for x in (rest.find("</div>"), rest.find("<!-- nesh-call-tracking")) if x>=0] or [len(rest)])
                body=body[:m.start()]+order_section(p)+rest[cut:]; changed=True
    # 2. photos (hero + brand card), same rules as page_photos
    if 'data-nesh-photo="hero"' not in body:
        m=re.match(r"\s*<!-- nesh-claim-band -->\s*<div.*?</div>\s*", body, flags=re.S)
        body=(body[:m.end()]+PP.hero(p)+body[m.end():]) if m else PP.hero(p)+body
        if p["brand"]:
            c=PP.card(p); mi=re.search(r"<h2[^>]*>[^<]*Included[^<]*</h2>\s*", body); mh=re.search(r"<h2[^>]*>\s*How the rebuild works\s*</h2>", body)
            body = body[:mi.end()]+c+body[mi.end():] if mi else (body[:mh.start()]+c+body[mh.start():] if mh else body+"\n"+c)
        changed=True
    return body if changed else None
only=sys.argv[1:]
done=0
for p in pages:
    if p["kind"]!="chipper" or p["handle"]=="wood-chipper-catalytic-converter-program": continue
    if only and p["handle"] not in only: continue
    nb=transform(p)
    if nb is None: continue
    r=gql("mutation($id:ID!,$page:PageUpdateInput!){ pageUpdate(id:$id, page:$page){ page{ handle } userErrors{ field message } } }",{"id":p["id"],"page":{"body":nb}})["pageUpdate"]
    if r["userErrors"]: print("ERROR", p["handle"], r["userErrors"]); continue
    p["body"]=nb; done+=1
    if only: print("updated", p["handle"], "| quote left:", "Get your quote" in nb or "Fitment Check" in nb)
json.dump(pages, open(SC+"all_pages.json","w")); print("updated", done)
