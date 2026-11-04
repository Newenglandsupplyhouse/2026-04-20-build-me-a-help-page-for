// Cat buyback offer (2026-11-04): adds the "Getting rid of your chipper cat? We'll buy it" section to
// /pages/wood-chipper-catalytic-converter-program (after #nesh-no-delete) and a short "Going with a new OEM
// converter instead?" blurb to the Bandit/Morbark/Vermeer rebuild product descriptions. Both live in Shopify
// page/product body_html, not the theme, so they are edited through the Admin REST API.
// Credentials: SHOPIFY_ADMIN_TOKEN / SHOPIFY_STORE_DOMAIN / SHOPIFY_API_VERSION are read from the nesh-crm
// Render service env vars using ~/.render-api-key.txt (same pattern as nesh-crm/set-ship-cost.mjs).
// Usage: node buyback_offer.mjs pull <dir>   -> saves current page + product JSON to <dir>
//        node buyback_offer.mjs dry  <dir>   -> shows what would change (idempotent: skips if data-nesh-buyback present)
//        node buyback_offer.mjs apply <dir>  -> PUTs the new bodies
// --- page ---
// --- products ---
import fs from "fs"; import os from "os"; import path from "path";
const SERVICE="srv-d93e90gjs32c73c79itg";
const renderKey=fs.readFileSync(path.join(os.homedir(),".render-api-key.txt"),"utf8").trim();
const ev=await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars?limit=100`,{headers:{authorization:`Bearer ${renderKey}`,accept:"application/json"}});
const vars=await ev.json(); const kv=k=>{const v=vars.find(v=>(v.envVar||v).key===k);return v?(v.envVar||v).value:null;};
const TOKEN=kv("SHOPIFY_ADMIN_TOKEN"), STORE=kv("SHOPIFY_STORE_DOMAIN"), VER=kv("SHOPIFY_API_VERSION")||"2025-07";
const api=async(p,opts={})=>{const r=await fetch(`https://${STORE}/admin/api/${VER}${p}`,{...opts,headers:{"X-Shopify-Access-Token":TOKEN,"content-type":"application/json"}});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,300)}}return{s:r.status,j};};
const cmd=process.argv[2]; const OUT=process.argv[3]; if(!OUT){console.log("usage: node buyback_offer.mjs pull|dry|apply <dir>");process.exit(1);}
if(cmd==="pull"){
  fs.mkdirSync(OUT,{recursive:true});
  const r=await api("/pages.json?handle=wood-chipper-catalytic-converter-program"); const pg=r.j.pages?.[0]; if(!pg){console.log("no page",r.s);process.exit(1);}
  fs.writeFileSync(path.join(OUT,"page__program.json"),JSON.stringify(pg,null,2)); console.log("page",pg.id,"body",pg.body_html.length,"chars");
  for(const h of ["bandit-wood-chipper-catalytic-converter-rebuild","morbark-wood-chipper-catalytic-converter-rebuild","vermeer-wood-chipper-catalytic-converter-rebuild"]){
    const q=await api("/products.json?handle="+h+"&fields=id,handle,title,body_html,tags"); const p=q.j.products?.[0]; if(!p){console.log("no product",h,q.s);continue;}
    fs.writeFileSync(path.join(OUT,"product__"+h+".json"),JSON.stringify(p,null,2)); console.log("product",p.id,h,"body",p.body_html.length,"chars");
  }
  process.exit(0);
}
const APPLY=cmd==="apply";
const L=OUT;

const PAGE_SECTION=`

  <!-- BUY YOUR CAT -->
  <section id="nesh-buy-cat" data-nesh-buyback="1">
    <style>
      #nesh-buy-cat { background:#eef5fb; border:2px solid var(--navy); border-radius:20px; padding:2.4rem 1.8rem 2.6rem; margin-top:2rem; }
      #nesh-buy-cat h2 { font-size:clamp(2rem,3.4vw,2.7rem); }
      #nesh-buy-cat .nesh-sec-sub { font-size:1.25rem; max-width:860px; }
      #nesh-buy-cat .nesh-bc-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:1.4rem; max-width:1160px; margin:1.6rem auto 0; }
      #nesh-buy-cat .nesh-bc-card { background:#fff; border:1px solid var(--line); border-top:7px solid var(--navy); border-radius:0 0 14px 14px; padding:1.8rem 1.7rem; box-shadow:0 4px 18px rgba(15,72,114,0.08); }
      #nesh-buy-cat .nesh-bc-card strong { display:block; color:var(--navy); font-size:1.45rem; line-height:1.25; margin-bottom:.8rem; }
      #nesh-buy-cat .nesh-bc-card p { margin:0; color:var(--ink); font-size:1.18rem; line-height:1.6; }
      #nesh-buy-cat .nesh-bc-close { text-align:center; font-size:1.45rem; line-height:1.4; color:var(--navy); font-weight:800; max-width:900px; margin:2rem auto 0; }
      #nesh-buy-cat .nesh-bc-btn { display:inline-block; margin-top:1rem; background:var(--amber); color:var(--navy-dark); font-weight:800; font-size:1.35rem; text-decoration:none; border-radius:12px; padding:1rem 1.8rem; }
      #nesh-buy-cat .nesh-bc-btn:hover { background:var(--amber-dark); }
      #nesh-buy-cat .nesh-bc-note { text-align:center; color:var(--ink); font-size:1.05rem; margin:1.2rem auto 0; max-width:800px; }
      @media screen and (max-width:749px){ #nesh-buy-cat { padding:1.6rem 1.1rem 2rem; } #nesh-buy-cat .nesh-bc-grid { grid-template-columns:1fr; } #nesh-buy-cat .nesh-bc-card strong { font-size:1.3rem; } #nesh-buy-cat .nesh-bc-card p { font-size:1.08rem; } #nesh-buy-cat .nesh-bc-close { font-size:1.25rem; } }
    </style>
    <h2>Getting rid of your chipper cat? We&rsquo;ll buy it.</h2>
    <p class="nesh-sec-sub">Decided to buy a new OEM converter, or retiring the machine? Don&rsquo;t scrap the old cat. Send us a picture and we&rsquo;ll send you back an offer price.</p>
    <div class="nesh-bc-grid">
      <div class="nesh-bc-card">
<strong>1. Snap a photo</strong><p>A clear picture of the converter &mdash; the whole unit and any tag or part number on it &mdash; plus the chipper&rsquo;s make and model.</p>
</div>
      <div class="nesh-bc-card">
<strong>2. Text or email it</strong><p>Text the photo to <b>774-701-6374</b> or email it to <b>jason@newenglandsupplyhouse.com</b>.</p>
</div>
      <div class="nesh-bc-card">
<strong>3. Get your offer</strong><p>We look it over and reply with an <b>offer price</b> for your cat.</p>
</div>
    </div>
    <p class="nesh-bc-close">Put some money back in your pocket instead of letting it rust.<br><a class="nesh-bc-btn" href="sms:+17747016374">&#128247; Text a photo to 774-701-6374</a> <a class="nesh-bc-btn" href="mailto:jason@newenglandsupplyhouse.com?subject=Offer%20on%20my%20chipper%20catalytic%20converter" style="background:var(--navy);color:#fff">&#9993;&#65039; Email a photo</a></p>
    <p class="nesh-bc-note">Wood chipper catalytic converters only &mdash; we don&rsquo;t buy car, truck, or other equipment cats.</p>
  </section>`;

const PRODUCT_BLOCK=`<h2 data-nesh-buyback="1">Going with a new OEM converter instead?</h2><p data-nesh-buyback="1">Don&rsquo;t scrap the old cat &mdash; we&rsquo;ll buy it. Text a photo of your wood chipper&rsquo;s catalytic converter (the whole unit, any tag or part number, and the chipper&rsquo;s make and model) to <strong>774-701-6374</strong>, or email it to <a href="mailto:jason@newenglandsupplyhouse.com?subject=Offer%20on%20my%20chipper%20catalytic%20converter">jason@newenglandsupplyhouse.com</a>, and we&rsquo;ll send you back an offer price. Wood chipper converters only.</p>`;

// --- page ---
const page=JSON.parse(fs.readFileSync(path.join(L,"page__program.json"),"utf8"));
let h=page.body_html;
if(h.includes('data-nesh-buyback')) console.log("page: already has buyback block, skipping");
else {
  const j=h.indexOf('<section id="nesh-no-delete">'); const e=h.indexOf('</section>',j)+'</section>'.length;
  if(j<0||e<10){console.log("page: anchor not found");process.exit(1);}
  const next=h.slice(e,e+300); if(!next.includes('<!-- FAQ -->')){console.log("page: unexpected content after gutting section:",JSON.stringify(next.slice(0,80)));process.exit(1);}
  const newBody=h.slice(0,e)+PAGE_SECTION+h.slice(e);
  console.log(`page ${page.id}: insert ${PAGE_SECTION.length} chars after #nesh-no-delete (body ${h.length} -> ${newBody.length})`);
  if(APPLY){ const r=await api(`/pages/${page.id}.json`,{method:"PUT",body:JSON.stringify({page:{id:page.id,body_html:newBody}})}); console.log("  PUT page:",r.s,r.s===200?"ok, body now "+r.j.page.body_html.length+" chars":JSON.stringify(r.j).slice(0,300)); }
}
// --- products ---
for(const b of ["bandit","morbark","vermeer"]){
  const p=JSON.parse(fs.readFileSync(path.join(L,`product__${b}-wood-chipper-catalytic-converter-rebuild.json`),"utf8"));
  if(p.body_html.includes('data-nesh-buyback')){console.log(`${b}: already has buyback block, skipping`);continue;}
  const anchor='<p>Questions? Call NESH at 774-701-6374.</p>'; const i=p.body_html.lastIndexOf(anchor);
  if(i<0){console.log(`${b}: anchor not found`);continue;}
  const newBody=p.body_html.slice(0,i)+PRODUCT_BLOCK+p.body_html.slice(i);
  console.log(`${b} ${p.id}: insert before closing Questions line (body ${p.body_html.length} -> ${newBody.length})`);
  if(APPLY){ const r=await api(`/products/${p.id}.json`,{method:"PUT",body:JSON.stringify({product:{id:p.id,body_html:newBody}})}); console.log("  PUT product:",r.s,r.s===200?"ok":JSON.stringify(r.j).slice(0,300)); }
}
