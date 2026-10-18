import json, os, sys, time, urllib.request, uuid
API="https://hgwaiq-dh.myshopify.com/admin/api/2025-07/graphql.json"
def gql(q, v=None):
    req=urllib.request.Request(API, data=json.dumps({"query":q,"variables":v or {}}).encode(), headers={"Content-Type":"application/json"})
    r=json.load(urllib.request.urlopen(req))
    if r.get("errors"): raise SystemExit("GraphQL errors: "+json.dumps(r["errors"])[:800])
    return r["data"]

def staged_upload(path):
    size=os.path.getsize(path); name=os.path.basename(path)
    d=gql("""mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }""",
        {"input":[{"resource":"FILE","filename":name,"mimeType":"image/jpeg","fileSize":str(size),"httpMethod":"POST"}]})
    su=d["stagedUploadsCreate"]
    if su["userErrors"]: raise SystemExit(su["userErrors"])
    t=su["stagedTargets"][0]
    b=uuid.uuid4().hex; body=b""
    for p in t["parameters"]:
        body+=f'--{b}\r\nContent-Disposition: form-data; name="{p["name"]}"\r\n\r\n{p["value"]}\r\n'.encode()
    body+=f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()+open(path,"rb").read()+f"\r\n--{b}--\r\n".encode()
    req=urllib.request.Request(t["url"], data=body, headers={"Content-Type":f"multipart/form-data; boundary={b}"}, method="POST")
    resp=urllib.request.urlopen(req); print("staged", name, resp.status)
    return t["resourceUrl"]

def file_create(resource_url, alt):
    d=gql("""mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ id fileStatus } userErrors{ field message } } }""",
        {"files":[{"originalSource":resource_url,"contentType":"IMAGE","alt":alt}]})
    fc=d["fileCreate"]
    if fc["userErrors"]: raise SystemExit(fc["userErrors"])
    fid=fc["files"][0]["id"]
    for _ in range(30):
        n=gql("""query($id:ID!){ node(id:$id){ ... on MediaImage{ fileStatus image{ url } } } }""",{"id":fid})["node"]
        if n["fileStatus"]=="READY" and n.get("image") and n["image"]["url"]: print("file ready", fid); return n["image"]["url"]
        if n["fileStatus"]=="FAILED": raise SystemExit("file failed "+fid)
        time.sleep(2)
    raise SystemExit("timeout waiting for file")

def add_media(product_id, url, alt):
    d=gql("""mutation($id:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$id, media:$media){ media{ id status } mediaUserErrors{ field message } } }""",
        {"id":product_id,"media":[{"originalSource":url,"mediaContentType":"IMAGE","alt":alt}]})
    pm=d["productCreateMedia"]
    if pm["mediaUserErrors"]: raise SystemExit(pm["mediaUserErrors"])
    return pm["media"][0]["id"]

if __name__=="__main__":
    products={"Bandit":"gid://shopify/Product/9237990408414","Morbark":"gid://shopify/Product/9237990473950","Vermeer":"gid://shopify/Product/9237990506718"}
    files=[("product-photos/before-after/before-after-full.jpg","wood chipper catalytic converter rebuild, before and after: worn dual-can converter next to the rebuilt unit"),
           ("product-photos/before-after/before-after-detail.jpg","wood chipper catalytic converter rebuild, before and after: worn inlet flange and new ceramic substrates inside the rebuilt unit")]
    cdn=[(file_create(staged_upload(p), a[0].upper()+a[1:]), a) for p,a in files]
    results={}
    for brand,pid in products.items():
        results[brand]=[add_media(pid,url,f"{brand} {alt}") for url,alt in cdn]
        print(brand, results[brand])
    json.dump({"cdn":cdn,"media":results}, open(sys.argv[1],"w"), indent=1)
