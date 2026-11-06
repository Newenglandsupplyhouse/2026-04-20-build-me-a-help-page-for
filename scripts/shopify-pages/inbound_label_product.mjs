// Prepaid inbound shipping label product (2026-11-05, Jason: "can i offer the customer the ability to buy a
// shipping label using my rates to send these into us"). Creates/updates the Shopify product
// /products/prepaid-inbound-shipping-label: the customer buys the label, the order carries their address, and
// Jason emails them a UPS Ground label (24 x 24 x 24 in, up to 40 lb, $10,000 coverage) bought at NESH's rate.
// Credentials: SHOPIFY_ADMIN_TOKEN / SHOPIFY_STORE_DOMAIN / SHOPIFY_API_VERSION from the nesh-crm Render service
// env vars via ~/.render-api-key.txt (same as scrap_cat_page.mjs). Never prints them.
// Usage: node inbound_label_product.mjs dry   --price 149 [--status draft|active]
//        node inbound_label_product.mjs apply --price 149 [--status draft|active]   (default status: active)
import fs from "fs"; import os from "os"; import path from "path";
const SERVICE="srv-d93e90gjs32c73c79itg";
const renderKey=fs.readFileSync(path.join(os.homedir(),".render-api-key.txt"),"utf8").trim();
const ev=await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars?limit=100`,{headers:{authorization:`Bearer ${renderKey}`,accept:"application/json"}});
const vars=await ev.json(); const kv=k=>{const v=vars.find(v=>(v.envVar||v).key===k);return v?(v.envVar||v).value:null;};
const TOKEN=kv("SHOPIFY_ADMIN_TOKEN"), STORE=kv("SHOPIFY_STORE_DOMAIN"), VER=kv("SHOPIFY_API_VERSION")||"2025-07";
const api=async(p,opts={})=>{const r=await fetch(`https://${STORE}/admin/api/${VER}${p}`,{...opts,headers:{"X-Shopify-Access-Token":TOKEN,"content-type":"application/json"}});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,300)}}return{s:r.status,j};};
const argv=process.argv.slice(2); const cmd=argv[0]; const opt=(k,d)=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:d;};
const PRICE=opt("--price",null); const STATUS=opt("--status","active");
if(!["dry","apply"].includes(cmd)||!PRICE||isNaN(+PRICE)){console.log("usage: node inbound_label_product.mjs dry|apply --price <usd> [--status draft|active]");process.exit(1);}
const APPLY=cmd==="apply";

const HANDLE="prepaid-inbound-shipping-label";
const TITLE="$250 Flat Rate Shipping Label: Send Your Unit to Us";
const SKU="NESH-INBOUND-LABEL";
const SEO_TITLE="$250 Flat Rate Shipping Label to Send Your Unit to Us | NESH";
const SEO_DESC="A prepaid UPS Ground shipping label you use to send your wood chipper catalytic converter to New England Supply House for rebuild. One flat $250 covers any address in the lower 48, a box up to 24 x 24 x 24 in and 40 lb, and $5,000 of coverage.";

const BODY=`<div class="nesh-inbound-label">
<p><strong>This is a shipping label, not a part.</strong> You use it to send your unit <strong>to us</strong>. Buy it, we email you a prepaid UPS Ground label, you put it on the box, and your converter ships to our shop in Massachusetts for its rebuild. Nothing is mailed to you.</p>

<p>One flat price, <strong>$250</strong>, from any address in the lower 48 states. No weighing, no zone pricing, no surprise at the UPS counter, where a box this size can run $300 or more at walk-in rates.</p>

<h2>What the $250 covers</h2>
<ul>
<li>A prepaid <strong>UPS Ground</strong> label from the shipping address on your order to New England Supply House.</li>
<li>One box up to <strong>24 x 24 x 24 inches</strong> and <strong>40 pounds</strong>. That fits any wood chipper catalytic converter we rebuild (Bandit, Morbark, Vermeer, and others) with packing around it.</li>
<li><strong>$5,000</strong> of coverage against loss or damage in transit.</li>
<li>Tracking, so you see it moving and we know when to expect it.</li>
</ul>

<h2>Return shipping is separate</h2>
<p>The shipping you pay at checkout on your rebuild order covers us sending the rebuilt converter <strong>back to you</strong>. It does not cover getting your unit here. This label is the inbound leg.</p>

<h2>Who should buy this</h2>
<p>Anyone without their own UPS or FedEx account with preferred rates. If you do have an account with good rates, ship the unit yourself and skip this label. It will almost certainly cost you less.</p>

<h2>How it works</h2>
<ol>
<li>Add this label to your rebuild order. At checkout, use the address the box will ship <em>from</em> as your shipping address, and check that your email is correct.</li>
<li>We email you the label as a PDF within <strong>1 business day</strong> (Monday to Friday).</li>
<li>Box the converter, tape the label on, and drop it at any UPS location, or schedule a UPS pickup from your address (UPS charges its own pickup fee).</li>
</ol>

<h2>Packing the unit</h2>
<p>Let it cool and drain it. Wrap it so nothing can rattle, fill the empty space in the box, and tape every seam. The housing takes a beating in transit if it can move. Damage caused by loose packing is not covered.</p>

<h2>Good to know</h2>
<ul>
<li>Alaska, Hawaii, and Puerto Rico, or a box bigger or heavier than the limits above: <a href="mailto:jason@newenglandsupplyhouse.com">email us</a> for a quote before you buy.</li>
<li>Not shipped yet after 30 days? Email us and we refund the label in full.</li>
<li>Selling us a scrap converter through our <a href="/pages/scrap-wood-chipper-catalytic-converters">buyback program</a>? You do not need this. We send that label free once you accept our offer.</li>
</ul>
</div>`;

const product={
  title:TITLE, handle:HANDLE, body_html:BODY, vendor:"New England Supply House", product_type:"Shipping label",
  tags:"service, shipping label, catalytic converter, wood chipper", status:STATUS,
  variants:[{ sku:SKU, price:(+PRICE).toFixed(2), taxable:false, requires_shipping:true, weight:0, weight_unit:"lb",
    inventory_management:null, inventory_policy:"continue", fulfillment_service:"manual" }],
  metafields_global_title_tag:SEO_TITLE, metafields_global_description_tag:SEO_DESC,
};

const q=await api(`/products.json?handle=${HANDLE}&fields=id,handle,title,status,variants`); const ex=q.j.products?.[0];
console.log(ex?`exists: product ${ex.id} status ${ex.status} price ${ex.variants?.[0]?.price}`:"not created yet");
console.log(`plan: ${ex?"update":"create"} ${HANDLE} price $${(+PRICE).toFixed(2)} status ${STATUS}; body ${BODY.length} chars; taxable no; needs shipping address yes`);
if(!APPLY){console.log("(dry: nothing changed)");process.exit(0);}

let id;
if(ex){
  const r=await api(`/products/${ex.id}.json`,{method:"PUT",body:JSON.stringify({product:{id:ex.id,title:TITLE,body_html:BODY,status:STATUS,tags:product.tags,product_type:product.product_type,vendor:product.vendor,metafields_global_title_tag:SEO_TITLE,metafields_global_description_tag:SEO_DESC}})});
  if(r.s!==200){console.log("update failed",r.s,JSON.stringify(r.j).slice(0,300));process.exit(1);}
  id=ex.id; const v=ex.variants[0];
  const vr=await api(`/variants/${v.id}.json`,{method:"PUT",body:JSON.stringify({variant:{id:v.id,price:(+PRICE).toFixed(2),sku:SKU,taxable:false,requires_shipping:true,inventory_management:null,inventory_policy:"continue"}})});
  if(vr.s!==200){console.log("variant update failed",vr.s,JSON.stringify(vr.j).slice(0,300));process.exit(1);}
  console.log("updated product",id,"variant",v.id,"price",vr.j.variant.price);
}else{
  const r=await api("/products.json",{method:"POST",body:JSON.stringify({product})});
  if(r.s!==201){console.log("create failed",r.s,JSON.stringify(r.j).slice(0,400));process.exit(1);}
  id=r.j.product.id; console.log("created product",id,"variant",r.j.product.variants[0].id,"price",r.j.product.variants[0].price,"status",r.j.product.status);
}
const chk=await api(`/products/${id}.json?fields=id,handle,status,published_at,variants`);
const p=chk.j.product; console.log(`now: ${p.handle} status ${p.status} published_at ${p.published_at} price ${p.variants[0].price} taxable ${p.variants[0].taxable} requires_shipping ${p.variants[0].requires_shipping}`);
console.log(`url: https://newenglandsupplyhouse.com/products/${HANDLE}`);
console.log("DONE");
