// Inbound-label offer (2026-11-05, Jason: "on the checkout page, lets make this an offer for them to add").
// The store is on the Grow plan, so the checkout page itself cannot be customised (that needs Shopify Plus).
// This puts the offer at the two places before checkout that the theme (Dawn, live theme "NESH Live") does control:
//   1. (removed 2026-11-05 at Jason's request: no offer on product pages; PRODUCT_LIQUID kept for reference only)
//      products tagged both `rebuild` and `catalytic-converter` (the Bandit/Morbark/Vermeer rebuilds).
//   2. templates/cart.json     -> a `custom-liquid` section between the cart items and the cart footer that renders
//      only when the cart holds a rebuild and does not yet hold the label.
// Both read the label product live (all_products['prepaid-inbound-shipping-label']) so the price shown is always current,
// and both add it with a plain POST /cart/add form. Idempotent: keyed by the block/section ids `nesh_inbound_label`.
// Credentials: SHOPIFY_ADMIN_TOKEN / SHOPIFY_STORE_DOMAIN / SHOPIFY_API_VERSION from the nesh-crm Render env vars.
// Usage: node inbound_label_offer.mjs pull <dir> | dry <dir> | apply <dir> | remove <dir>   (<dir> gets before/after copies)
import fs from "fs"; import os from "os"; import path from "path";
const SERVICE="srv-d93e90gjs32c73c79itg";
const renderKey=fs.readFileSync(path.join(os.homedir(),".render-api-key.txt"),"utf8").trim();
const ev=await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars?limit=100`,{headers:{authorization:`Bearer ${renderKey}`,accept:"application/json"}});
const vars=await ev.json(); const kv=k=>{const v=vars.find(v=>(v.envVar||v).key===k);return v?(v.envVar||v).value:null;};
const TOKEN=kv("SHOPIFY_ADMIN_TOKEN"), STORE=kv("SHOPIFY_STORE_DOMAIN"), VER=kv("SHOPIFY_API_VERSION")||"2025-07";
const api=async(p,opts={})=>{const r=await fetch(`https://${STORE}/admin/api/${VER}${p}`,{...opts,headers:{"X-Shopify-Access-Token":TOKEN,"content-type":"application/json"}});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,300)}}return{s:r.status,j};};
const cmd=process.argv[2], OUT=process.argv[3];
if(!OUT||!["pull","dry","apply","remove"].includes(cmd)){console.log("usage: node inbound_label_offer.mjs pull|dry|apply|remove <dir>");process.exit(1);}
fs.mkdirSync(OUT,{recursive:true});

const LABEL_HANDLE="prepaid-inbound-shipping-label";
const ID="nesh_inbound_label";

// ---- the Liquid (shared copy; product block and cart section differ only in their guard)
const OFFER_INNER=`{%- assign nesh_lbl = all_products['${LABEL_HANDLE}'] -%}
{%- if nesh_lbl.available -%}
<div class="nesh-inbound-offer" style="margin:1.2rem 0;padding:1rem 1.2rem;border:1px solid #d9e2ec;border-radius:10px;background:#f4f7fa;color:#1f2933;font-size:.95rem;line-height:1.5;">
  <p style="margin:0 0 .4rem;font-weight:700;font-size:1.05rem;color:#0f4872;">Need a shipping label to send your unit to us?</p>
  <p style="margin:0 0 .6rem;color:#1f2933;">Add a <strong>{{ nesh_lbl.price | money_without_trailing_zeros }} flat rate prepaid UPS Ground label</strong>: any address in the lower 48, box up to 24 x 24 x 24 in and 40 lb, $5,000 coverage, emailed to you within 1 business day. <strong>The shipping you pay at checkout covers us sending the rebuilt converter back to you. This label is for getting your unit to us.</strong></p>
  <p style="margin:0 0 .8rem;color:#52606d;">Only worth it if you do not have your own UPS or FedEx account with preferred rates. If you do, shipping it yourself will likely cost less.</p>
  <form method="post" action="/cart/add" style="margin:0;">
    <input type="hidden" name="id" value="{{ nesh_lbl.selected_or_first_available_variant.id }}">
    <input type="hidden" name="quantity" value="1">
    <button type="submit" style="margin:0;padding:.7rem 1.2rem;border:0;border-radius:6px;background:#0f4872;color:#fff;font-weight:600;cursor:pointer;">Add {{ nesh_lbl.price | money_without_trailing_zeros }} flat rate label</button>
    <a href="{{ nesh_lbl.url }}" style="margin-left:1rem;color:#0f4872;text-decoration:underline;">Details</a>
  </form>
</div>
{%- endif -%}`;
const PRODUCT_LIQUID=`{%- comment -%} ${ID}: prepaid inbound label offer (scripts/shopify-pages/inbound_label_offer.mjs) {%- endcomment -%}
{%- if product.tags contains 'rebuild' and product.tags contains 'catalytic-converter' -%}
${OFFER_INNER}
{%- endif -%}`;
const CART_LIQUID=`{%- comment -%} ${ID}: prepaid inbound label offer (scripts/shopify-pages/inbound_label_offer.mjs) {%- endcomment -%}
{%- assign nesh_has_rebuild = false -%}{%- assign nesh_has_label = false -%}
{%- for item in cart.items -%}
  {%- if item.product.handle == '${LABEL_HANDLE}' -%}{%- assign nesh_has_label = true -%}
  {%- elsif item.product.tags contains 'rebuild' and item.product.tags contains 'catalytic-converter' -%}{%- assign nesh_has_rebuild = true -%}{%- endif -%}
{%- endfor -%}
{%- if nesh_has_rebuild and nesh_has_label == false -%}
<div class="page-width">
${OFFER_INNER}
</div>
{%- endif -%}`;

const th=await api("/themes.json?fields=id,name,role"); const live=(th.j.themes||[]).find(t=>t.role==="main");
if(!live){console.log("no live theme",th.s);process.exit(1);} console.log(`live theme ${live.id} "${live.name}"`);
const getAsset=async(key)=>{const a=await api(`/themes/${live.id}/assets.json?asset[key]=${encodeURIComponent(key)}`); if(a.s!==200)throw new Error(key+" "+a.s); return a.j.asset.value;};
const putAsset=async(key,value)=>{const a=await api(`/themes/${live.id}/assets.json`,{method:"PUT",body:JSON.stringify({asset:{key,value}})}); if(a.s!==200)throw new Error(key+" PUT "+a.s+" "+JSON.stringify(a.j).slice(0,300)); return a.j.asset;};
const lbl=await api(`/products.json?handle=${LABEL_HANDLE}&fields=id,status,variants`); const lp=lbl.j.products?.[0];
console.log("label product:",lp?`${lp.id} ${lp.status} $${lp.variants[0].price}`:"MISSING (run inbound_label_product.mjs first)");

const productJson=await getAsset("templates/product.json"), cartJson=await getAsset("templates/cart.json");
fs.writeFileSync(path.join(OUT,"product.json.before"),productJson); fs.writeFileSync(path.join(OUT,"cart.json.before"),cartJson);
const pj=JSON.parse(productJson), cj=JSON.parse(cartJson);
const main=pj.sections.main; if(!main||main.type!=="main-product"){console.log("product.json has no main-product section");process.exit(1);}
const pHas=!!main.blocks?.[ID], cHas=!!cj.sections?.[ID];
console.log(`product.json: main-product blocks [${main.block_order.join(", ")}] -> offer block ${pHas?"present":"absent"}`);
console.log(`cart.json: sections [${cj.order.join(", ")}] -> offer section ${cHas?"present":"absent"}`);
if(cmd==="pull"){process.exit(0);}

if(cmd==="remove"){
  if(pHas){delete main.blocks[ID]; main.block_order=main.block_order.filter(b=>b!==ID);}
  if(cHas){delete cj.sections[ID]; cj.order=cj.order.filter(s=>s!==ID);}
}else{
  // 2026-11-05 Jason: "Do not list this offer on the product page, only on the checkout page, so as not to confuse customers"
  // -> the product-page block is never installed (and is removed if present); only the cart-page section stays.
  if(pHas){delete main.blocks[ID]; main.block_order=main.block_order.filter(b=>b!==ID);}
  void PRODUCT_LIQUID;
  cj.sections[ID]={type:"custom-liquid",settings:{custom_liquid:CART_LIQUID,color_scheme:"background-2",padding_top:0,padding_bottom:24}};
  if(!cHas){const i=cj.order.indexOf("cart-footer"); cj.order.splice(i>=0?i:cj.order.length,0,ID);}
}
const newP=JSON.stringify(pj,null,2), newC=JSON.stringify(cj,null,2);
fs.writeFileSync(path.join(OUT,"product.json.after"),newP); fs.writeFileSync(path.join(OUT,"cart.json.after"),newC);
console.log(`plan: product.json block_order -> [${main.block_order.join(", ")}]; cart.json order -> [${cj.order.join(", ")}]`);
if(cmd==="dry"){console.log("(dry: nothing changed)");process.exit(0);}
await putAsset("templates/product.json",newP); console.log("templates/product.json written");
await putAsset("templates/cart.json",newC); console.log("templates/cart.json written");
const chkP=JSON.parse(await getAsset("templates/product.json")), chkC=JSON.parse(await getAsset("templates/cart.json"));
console.log(`verify: product block ${chkP.sections.main.blocks[ID]?"present":"absent"}, cart section ${chkC.sections[ID]?"present":"absent"}`);
// keep the local theme copy in step when it exists (it is not a git repo)
for(const [f,v] of [["templates/product.json",newP],["templates/cart.json",newC]]){const lp2=path.join(os.homedir(),"shopify-theme",f); if(fs.existsSync(path.dirname(lp2))){fs.writeFileSync(lp2,v); console.log("local copy updated:",lp2);}}
console.log("DONE");
