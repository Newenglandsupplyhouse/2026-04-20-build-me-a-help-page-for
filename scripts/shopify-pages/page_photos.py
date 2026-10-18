import sys, json, re
sys.path.insert(0, ".")
from shopify_upload import gql
SC="./"
pages=json.load(open(SC+"all_pages.json")); models=json.load(open(SC+"models.json"))
BA="https://cdn.shopify.com/s/files/1/0725/0034/7102/files/before-after-full.jpg?v=1792282660"
DCL="https://cdn.shopify.com/s/files/1/0725/0034/7102/files/10-dcl-minex-bench-full.jpg?v=1792284622"
DCL_URL="/products/industrial-catalytic-converter-rebuild-re-pipe-dcl-mine-x-and-similar"
IMG='style="width:100%;max-width:720px;display:block;border:1px solid #e2e8f0;border-radius:12px;background:#fff"'
CAP='style="font-size:.9rem;color:#64748b;margin-top:.45rem"'
def hero(p):
    if p["kind"]=="chipper":
        return (f'<figure data-nesh-photo="hero" style="margin:0 0 1.4rem"><img src="{BA}" alt="Before and after: a worn wood chipper catalytic converter next to the same unit rebuilt by New England Supply House" loading="eager" {IMG}>'
                f'<figcaption data-nesh-note="rep" style="margin:10px 0 0;max-width:720px;padding:12px 16px;background:rgba(240,180,41,.16);border-left:5px solid #f0b429;border-radius:8px;color:#14213d;font-weight:700;font-size:16px;line-height:1.4">Representative photo. Your converter may look very different depending on your machine and engine.</figcaption></figure>\n')
    return (f'<figure data-nesh-photo="hero" style="margin:0 0 1.4rem"><img src="{DCL}" alt="DCL Mine-X industrial catalytic converter after rebuild, with new welded inlet pipe" loading="eager" {IMG}>'
            f'<figcaption {CAP}>A DCL Mine-X canister converter after rebuild and re-pipe at our shop. <a href="{DCL_URL}" style="font-weight:700">Order the industrial rebuild &amp; re-pipe online</a> or call for a quote.</figcaption></figure>\n')
def card(p):
    b=p["brand"]; url=models[b]["card_url"]; name=b.capitalize()
    return (f'<figure data-nesh-photo="card" style="margin:1.2rem 0 1.6rem"><img src="{url}" alt="What is included in the {name} wood chipper catalytic converter rebuild: rebuilt converter with new ceramic substrates and two new Fel-Pro 61457 flange gaskets" loading="lazy" style="width:100%;max-width:520px;display:block;border:1px solid #e2e8f0;border-radius:12px">'
            f'<figcaption {CAP}>Every {name} rebuild ships with new ceramic substrates installed and two new Fel-Pro 61457 flange gaskets. Converter shown is representative; yours is rebuilt and returned.</figcaption></figure>\n')
HUB_NOTE=(f'<p data-nesh-photo="hub-link" style="padding:.9rem 1.1rem;border:1px solid #e2e8f0;border-radius:10px;background:#f4f7fa"><strong>Order online:</strong> <a href="{DCL_URL}">Industrial Catalytic Converter Rebuild &amp; Re-Pipe (DCL Mine-X and similar)</a> &mdash; $2,000 per unit, new welded inlet and outlet pipes included. Prefer to talk first? Call <a href="tel:17747016374">774-701-6374</a>.</p>\n')
def transform(p):
    body=p["body"]
    if 'data-nesh-photo="hero"' in body: return None
    m=re.match(r"\s*<!-- nesh-claim-band -->\s*<div.*?</div>\s*", body, flags=re.S)
    body = (body[:m.end()]+hero(p)+body[m.end():]) if m else hero(p)+body
    if p["brand"]:
        c=card(p)
        mi=re.search(r"<h2[^>]*>[^<]*Included[^<]*</h2>\s*", body)
        mh=re.search(r"<h2[^>]*>\s*How the rebuild works\s*</h2>", body)
        if mi: body=body[:mi.end()]+c+body[mi.end():]
        elif mh: body=body[:mh.start()]+c+body[mh.start():]
        else: body=body+"\n"+c
    if p["handle"]=="catalytic-converter-rebuilds-installations":
        mp=re.search(r"</p>\s*", body[body.find("</figure>"):]); i=body.find("</figure>")+mp.end()
        body=body[:i]+HUB_NOTE+body[i:]
    return body
if __name__=='__main__':
    only=sys.argv[1:]  # handles for a dry run; empty = all
    done=skipped=0
    for p in pages:
        if only and p["handle"] not in only: continue
        nb=transform(p)
        if nb is None: skipped+=1; continue
        r=gql("mutation($id:ID!,$page:PageUpdateInput!){ pageUpdate(id:$id, page:$page){ page{ handle } userErrors{ field message } } }",{"id":p["id"],"page":{"body":nb}})["pageUpdate"]
        if r["userErrors"]: print("ERROR", p["handle"], r["userErrors"]); continue
        p["body"]=nb; done+=1
        if only: print("updated", p["handle"])
    json.dump(pages, open(SC+"all_pages.json","w"))
    print(f"updated {done}, skipped (already had photo) {skipped}")
