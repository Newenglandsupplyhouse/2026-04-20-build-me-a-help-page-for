// Scrap cat page (2026-11-04): creates/updates the Google-indexable "We buy wood chipper catalytic converters"
// page at /pages/scrap-wood-chipper-catalytic-converters, sets its SEO title/description metafields, and adds a
// link to it from the buyback section on /pages/wood-chipper-catalytic-converter-program and from the buyback
// blurb on the Bandit/Morbark/Vermeer rebuild product pages. All of that is Shopify page/product body_html,
// edited through the Admin REST API (not the theme repo).
// Credentials: SHOPIFY_ADMIN_TOKEN / SHOPIFY_STORE_DOMAIN / SHOPIFY_API_VERSION come from the nesh-crm Render
// service env vars via ~/.render-api-key.txt (same as buyback_offer.mjs / nesh-crm/set-ship-cost.mjs).
// Usage: node scrap_cat_page.mjs pull <dir>   -> saves current page (if any) + program page + products to <dir>
//        node scrap_cat_page.mjs dry  <dir>   -> shows what would change
//        node scrap_cat_page.mjs apply <dir>  -> creates/updates the page, metafields, and the links
import fs from "fs"; import os from "os"; import path from "path";
const SERVICE="srv-d93e90gjs32c73c79itg";
const renderKey=fs.readFileSync(path.join(os.homedir(),".render-api-key.txt"),"utf8").trim();
const ev=await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars?limit=100`,{headers:{authorization:`Bearer ${renderKey}`,accept:"application/json"}});
const vars=await ev.json(); const kv=k=>{const v=vars.find(v=>(v.envVar||v).key===k);return v?(v.envVar||v).value:null;};
const TOKEN=kv("SHOPIFY_ADMIN_TOKEN"), STORE=kv("SHOPIFY_STORE_DOMAIN"), VER=kv("SHOPIFY_API_VERSION")||"2025-07";
const api=async(p,opts={})=>{const r=await fetch(`https://${STORE}/admin/api/${VER}${p}`,{...opts,headers:{"X-Shopify-Access-Token":TOKEN,"content-type":"application/json"}});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,300)}}return{s:r.status,j};};
const cmd=process.argv[2]; const OUT=process.argv[3]; if(!OUT||!["pull","dry","apply"].includes(cmd)){console.log("usage: node scrap_cat_page.mjs pull|dry|apply <dir>");process.exit(1);}

const HANDLE="scrap-wood-chipper-catalytic-converters";
const URL=`https://newenglandsupplyhouse.com/pages/${HANDLE}`;
const TITLE="We Buy Wood Chipper Catalytic Converters";
const SEO_TITLE="We Buy Wood Chipper Catalytic Converters | Free Shipping Label";
const SEO_DESC="Scrapping or replacing a wood chipper catalytic converter? New England Supply House buys used Bandit, Morbark, Vermeer and other chipper cats. Text a photo, get an offer, we send a prepaid shipping label.";
const PRODUCTS=["bandit","morbark","vermeer"];

if(cmd==="pull"){
  fs.mkdirSync(OUT,{recursive:true});
  const r=await api(`/pages.json?handle=${HANDLE}`); const pg=r.j.pages?.[0];
  if(pg){fs.writeFileSync(path.join(OUT,"page__scrap.json"),JSON.stringify(pg,null,2)); console.log("scrap page exists",pg.id,"body",pg.body_html.length,"chars");} else console.log("scrap page: none yet");
  const q=await api("/pages.json?handle=wood-chipper-catalytic-converter-program"); const pp=q.j.pages?.[0]; if(!pp){console.log("no program page",q.s);process.exit(1);}
  fs.writeFileSync(path.join(OUT,"page__program.json"),JSON.stringify(pp,null,2)); console.log("program page",pp.id,"body",pp.body_html.length,"chars");
  for(const b of PRODUCTS){
    const h=`${b}-wood-chipper-catalytic-converter-rebuild`;
    const x=await api("/products.json?handle="+h+"&fields=id,handle,title,body_html"); const p=x.j.products?.[0]; if(!p){console.log("no product",h,x.s);continue;}
    fs.writeFileSync(path.join(OUT,"product__"+h+".json"),JSON.stringify(p,null,2)); console.log("product",p.id,h,"body",p.body_html.length,"chars");
  }
  process.exit(0);
}
const APPLY=cmd==="apply";

const FAQ=[
  ["Do you really send a shipping label?","Yes. Once you accept the offer, we email you a prepaid shipping label. Box the converter, tape the label on, and drop it at the carrier. Shipping costs you nothing."],
  ["How do I get paid?","We pay you once the converter arrives and matches the photos you sent. Tell us how you want to be paid when you accept the offer and we will set it up."],
  ["What if the converter is plugged, cracked, or melted?","Send the photo anyway. We rebuild these units, so a damaged chipper cat is still worth money to us. The offer reflects the condition, and there is no obligation to accept it."],
  ["Which wood chippers do you buy converters from?","Any wood chipper, gas or diesel: Bandit, Morbark, Vermeer, Carlton, Rayco, Woodsman, Altec, and others. If it came off a chipper, we want to see it."],
  ["Do you buy car, truck, or other equipment catalytic converters?","No. We only buy wood chipper catalytic converters. Automotive cats and converters from forklifts, skid steers, or other equipment are not part of this program."],
  ["Why not just take it to a scrap yard?","A scrap yard prices a chipper cat as a generic core by weight. We rebuild wood chipper converters, so the unit is worth more to us than it is as scrap. It takes one photo to find out what we will pay."],
];
const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/'/g,"&rsquo;");
const SMS="sms:+17747016374?&amp;body=Here%27s%20a%20photo%20of%20my%20chipper%20cat%20-%20what%20will%20you%20pay%20for%20it%3F";
const MAIL="mailto:jason@newenglandsupplyhouse.com?subject=Offer%20on%20my%20wood%20chipper%20catalytic%20converter";

const PAGE_HTML=`<style>
.main-page-title{display:none!important;}
.nesh-scrap *{box-sizing:border-box;}
.nesh-scrap{--navy:#0f4872;--navy-dark:#0a3354;--amber:#f0b429;--amber-dark:#de911d;--ink:#1f2933;--muted:#52606d;--panel:#f4f7fa;--line:#e1e7ec;color:var(--ink);line-height:1.6;}
.nesh-scrap h2{font-size:clamp(1.8rem,3vw,2.4rem);color:var(--navy);text-align:center;margin:0 0 .5rem;line-height:1.2;}
.nesh-scrap .nesh-sec-sub{text-align:center;color:var(--muted);font-size:1.25rem;max-width:720px;margin:0 auto 2rem;}
.nesh-scrap section{margin:3.2rem 0;}
.nesh-scrap .nesh-hero{background:radial-gradient(130% 130% at 0% 0%,#134c79 0%,#0a3354 52%,#07263f 100%);border-radius:18px;padding:3.2rem 2rem;text-align:center;color:#fff;margin:0 0 2.5rem;}
.nesh-scrap .nesh-hero h1{color:#fff;font-size:clamp(2rem,4vw,2.9rem);line-height:1.1;margin:0 0 .9rem;font-weight:800;}
.nesh-scrap .nesh-hero h1 em{font-style:italic;color:var(--amber);}
.nesh-scrap .nesh-hero p{color:#c7d4e2;font-size:clamp(1.1rem,1.6vw,1.3rem);max-width:760px;margin:0 auto 1.4rem;line-height:1.55;}
.nesh-scrap .nesh-hero p strong{color:#fff;}
.nesh-scrap .nesh-btn{display:inline-block;background:var(--amber);color:var(--navy-dark);font-weight:800;font-size:1.3rem;text-decoration:none;border-radius:12px;padding:1rem 1.8rem;margin:.3rem .3rem 0;box-shadow:0 3px 0 #c98f13;}
.nesh-scrap .nesh-btn:hover{background:#f6c34a;}
.nesh-scrap .nesh-btn.alt{background:#fff;color:var(--navy);box-shadow:0 3px 0 #c9d3dc;}
.nesh-scrap .nesh-hero .nesh-note{color:#aebfd0;font-size:.95rem;margin:1.1rem 0 0;}
.nesh-scrap .nesh-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1.2rem;max-width:1160px;margin:0 auto;}
.nesh-scrap .nesh-card{background:#fff;border:1px solid var(--line);border-top:7px solid var(--navy);border-radius:0 0 14px 14px;padding:1.6rem 1.5rem;box-shadow:0 4px 18px rgba(15,72,114,.08);}
.nesh-scrap .nesh-card strong{display:block;color:var(--navy);font-size:1.35rem;line-height:1.25;margin-bottom:.7rem;}
.nesh-scrap .nesh-card p{margin:0;font-size:1.12rem;line-height:1.6;}
.nesh-scrap .nesh-who{display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;max-width:960px;margin:0 auto;}
.nesh-scrap .nesh-who div{background:var(--panel);border-left:6px solid var(--amber);border-radius:0 12px 12px 0;padding:1.2rem 1.4rem;font-size:1.15rem;line-height:1.5;}
.nesh-scrap .nesh-who div b{color:var(--navy);display:block;font-size:1.25rem;margin-bottom:.25rem;}
.nesh-scrap .nesh-photo{background:#fff8e6;border:2px solid var(--amber);border-radius:16px;padding:1.8rem 1.6rem;max-width:900px;margin:0 auto;}
.nesh-scrap .nesh-photo h3{color:var(--navy);margin:0 0 .8rem;font-size:1.5rem;}
.nesh-scrap .nesh-photo ul{margin:0;padding-left:1.3rem;font-size:1.15rem;line-height:1.7;}
.nesh-scrap .nesh-makes{text-align:center;font-size:1.15rem;max-width:860px;margin:0 auto;}
.nesh-scrap .nesh-makes span{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:20px;padding:.3rem .9rem;margin:.25rem;font-weight:700;color:var(--navy);}
.nesh-scrap .nesh-cta{background:#eef5fb;border:2px solid var(--navy);border-radius:20px;padding:2.4rem 1.8rem;text-align:center;}
.nesh-scrap .nesh-cta p{font-size:1.35rem;color:var(--navy);font-weight:800;max-width:800px;margin:0 auto 1rem;line-height:1.4;}
.nesh-scrap .nesh-faq{max-width:760px;margin:0 auto;}
.nesh-scrap .nesh-faq details{border:1px solid var(--line);border-radius:10px;margin-bottom:.85rem;background:#fff;overflow:hidden;}
.nesh-scrap .nesh-faq summary{cursor:pointer;padding:1.1rem 1.4rem;font-weight:700;color:var(--navy);font-size:1.22rem;list-style:none;position:relative;padding-right:3rem;}
.nesh-scrap .nesh-faq summary::-webkit-details-marker{display:none;}
.nesh-scrap .nesh-faq summary::after{content:"+";position:absolute;right:1.4rem;top:50%;transform:translateY(-50%);font-size:1.6rem;color:var(--amber);font-weight:700;line-height:1;}
.nesh-scrap .nesh-faq details[open] summary::after{content:"\\2212";}
.nesh-scrap .nesh-faq details[open] summary{background:var(--panel);}
.nesh-scrap .nesh-faq .nesh-faq-a{padding:0 1.4rem 1.25rem;color:var(--muted);font-size:1.18rem;line-height:1.6;}
.nesh-scrap .nesh-links{text-align:center;color:var(--muted);font-size:1.05rem;}
.nesh-scrap a{color:var(--navy);}
@media screen and (max-width:749px){.nesh-scrap .nesh-grid,.nesh-scrap .nesh-who{grid-template-columns:1fr;}.nesh-scrap .nesh-hero{padding:2.2rem 1.2rem;}.nesh-scrap .nesh-btn{font-size:1.15rem;padding:.9rem 1.3rem;display:block;}.nesh-scrap .nesh-cta{padding:1.6rem 1.1rem;}}
</style>

<div class="nesh-scrap">

  <section class="nesh-hero">
    <h1>Scrapping a wood chipper catalytic converter? <em>We&rsquo;ll buy it.</em></h1>
    <p>Text us a photo of the cat you&rsquo;re getting rid of. We send you back an offer price, and if you take it, we email you a <strong>prepaid shipping label</strong>. No scrap yard trip, no shipping cost, nothing to fill out.</p>
    <a class="nesh-btn" href="${SMS}">&#128247; Text a photo to 774-701-6374</a>
    <a class="nesh-btn alt" href="${MAIL}">&#9993;&#65039; Email a photo</a>
    <p class="nesh-note">Wood chipper catalytic converters only. Any make, gas or diesel. We send labels anywhere in the U.S.</p>
  </section>

  <section>
    <h2>Who this is for</h2>
    <p class="nesh-sec-sub">If a chipper cat is coming off a machine and isn&rsquo;t going back on, we want to see it.</p>
    <div class="nesh-who">
      <div><b>Buying a new OEM converter</b>The old one is coming out anyway. Sell it to us instead of letting it sit on a shelf.</div>
      <div><b>Deleting the cat</b>Going straight pipe or gutting the housing? The unit you pull has value. Don&rsquo;t throw it in the scrap pile.</div>
      <div><b>Getting rid of the machine</b>Selling, trading in, or scrapping the whole chipper? Pull the converter first and get paid for it separately.</div>
      <div><b>Dead chipper in the yard</b>A machine that isn&rsquo;t running still has a cat on it. Snap a photo and find out what it&rsquo;s worth.</div>
    </div>
  </section>

  <section>
    <h2>How it works</h2>
    <p class="nesh-sec-sub">One photo starts it. The whole thing is four steps.</p>
    <div class="nesh-grid">
      <div class="nesh-card"><strong>1. Snap a photo</strong><p>A clear picture of the converter: the whole unit and any tag or part number on it. Tell us the chipper&rsquo;s make and model.</p></div>
      <div class="nesh-card"><strong>2. Text or email it</strong><p>Text the photo to <b>774-701-6374</b> or email it to <b>jason@newenglandsupplyhouse.com</b>.</p></div>
      <div class="nesh-card"><strong>3. Get your offer</strong><p>We look it over and reply with an offer price. No obligation. If you&rsquo;d rather scrap it, no hard feelings.</p></div>
      <div class="nesh-card"><strong>4. We send the label</strong><p>Accept the offer and we email you a <b>prepaid shipping label</b>. Box it, tape the label on, drop it off. You get paid when it arrives.</p></div>
    </div>
  </section>

  <section>
    <div class="nesh-photo">
      <h3>What to put in the photo</h3>
      <ul>
        <li>The whole converter, so we can see the size and the inlet and outlet.</li>
        <li>Any tag, stamp, or part number on the housing (a second close-up is great).</li>
        <li>The chipper it came off: make and model, and gas or diesel if you know it.</li>
        <li>Anything obvious: cracked housing, loose substrate, melted or plugged. It still has value. We just want to price it right the first time.</li>
      </ul>
    </div>
  </section>

  <section>
    <h2>Which chipper cats we buy</h2>
    <p class="nesh-sec-sub">Any wood chipper, any year, gas or diesel. These are the ones we see most.</p>
    <div class="nesh-makes">
      <span>Bandit</span><span>Morbark</span><span>Vermeer</span><span>Carlton</span><span>Rayco</span><span>Woodsman</span><span>Altec</span><span>Any other chipper</span>
    </div>
    <p class="nesh-links" style="margin-top:1.4rem">We don&rsquo;t buy car, truck, forklift, skid steer, or other equipment converters. Wood chippers only.</p>
  </section>

  <section>
    <h2>Why it&rsquo;s worth more to us than to a scrap yard</h2>
    <p class="nesh-sec-sub">A yard prices a chipper cat as a generic core by weight. We&rsquo;re the shop that <a href="/pages/wood-chipper-catalytic-converter-program">rebuilds wood chipper catalytic converters</a>, so the same unit is worth more to us, and we cover the shipping to get it here.</p>
  </section>

  <section>
    <div class="nesh-cta">
      <p>Put some money back in your pocket instead of letting it rust.</p>
      <a class="nesh-btn" href="${SMS}">&#128247; Text a photo to 774-701-6374</a>
      <a class="nesh-btn alt" href="${MAIL}">&#9993;&#65039; Email a photo</a>
      <p style="font-size:1.05rem;font-weight:400;color:var(--muted);margin-top:1.1rem">Prefer to talk? Call <a href="tel:+17747016374">774-701-6374</a> and ask for Jason.</p>
    </div>
  </section>

  <section>
    <h2>Frequently asked questions</h2>
    <div class="nesh-faq">
${FAQ.map(([q,a])=>`      <details><summary>${esc(q)}</summary><div class="nesh-faq-a">${esc(a)}</div></details>`).join("\n")}
    </div>
  </section>

  <section>
    <p class="nesh-links">Not getting rid of it? Keeping the machine and the cat&rsquo;s just plugged or failed? <a href="/pages/wood-chipper-catalytic-converter-program">We rebuild wood chipper catalytic converters</a> on a core exchange for a fraction of OEM.<br>New England Supply House &middot; Foxboro, MA &middot; shipping labels nationwide.</p>
  </section>

</div>

<script type="application/ld+json">
${JSON.stringify({
  "@context":"https://schema.org",
  "@graph":[
    {"@type":"Service","name":"Wood Chipper Catalytic Converter Buyback","serviceType":"We buy used wood chipper catalytic converters","description":SEO_DESC,
     "provider":{"@type":"LocalBusiness","name":"New England Supply House","telephone":"+1-774-701-6374","email":"jason@newenglandsupplyhouse.com","address":{"@type":"PostalAddress","addressLocality":"Foxboro","addressRegion":"MA","addressCountry":"US"},"url":"https://newenglandsupplyhouse.com"},
     "areaServed":{"@type":"Country","name":"United States"},"url":URL},
    {"@type":"FAQPage","mainEntity":FAQ.map(([q,a])=>({"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}}))},
    {"@type":"BreadcrumbList","itemListElement":[
      {"@type":"ListItem","position":1,"name":"Home","item":"https://newenglandsupplyhouse.com"},
      {"@type":"ListItem","position":2,"name":"Wood Chipper Catalytic Converter Program","item":"https://newenglandsupplyhouse.com/pages/wood-chipper-catalytic-converter-program"},
      {"@type":"ListItem","position":3,"name":TITLE,"item":URL}]}
  ]},null,1)}
</script>
`;

// --- the page itself ---
const existing=fs.existsSync(path.join(OUT,"page__scrap.json"))?JSON.parse(fs.readFileSync(path.join(OUT,"page__scrap.json"),"utf8")):null;
let pageId=existing?.id;
const norm=s=>s.replace(/\s+/g," ").trim(); // Shopify re-serializes the stored body (whitespace only), so compare loosely
if(existing && norm(existing.body_html)===norm(PAGE_HTML) && existing.title===TITLE) console.log(`scrap page ${pageId}: body unchanged, skip`);
else {
  console.log(existing?`scrap page ${pageId}: update body (${existing.body_html.length} -> ${PAGE_HTML.length} chars)`:`scrap page: CREATE /pages/${HANDLE} (${PAGE_HTML.length} chars)`);
  if(APPLY){
    const fields={title:TITLE,handle:HANDLE,body_html:PAGE_HTML,published:true};
    const r=existing?await api(`/pages/${pageId}.json`,{method:"PUT",body:JSON.stringify({page:{id:pageId,...fields}})}):await api("/pages.json",{method:"POST",body:JSON.stringify({page:fields})});
    if(r.s!==200&&r.s!==201){console.log("  page save FAILED",r.s,JSON.stringify(r.j).slice(0,400));process.exit(1);}
    pageId=r.j.page.id; console.log("  saved page",pageId,"handle",r.j.page.handle,"published_at",r.j.page.published_at);
  }
}
// --- SEO metafields ---
if(pageId){
  const m=await api(`/pages/${pageId}/metafields.json`); const have=k=>(m.j.metafields||[]).find(x=>x.namespace==="global"&&x.key===k);
  for(const [k,v] of [["title_tag",SEO_TITLE],["description_tag",SEO_DESC]]){
    const cur=have(k); if(cur&&cur.value===v){console.log(`  meta ${k}: unchanged`);continue;}
    console.log(`  meta ${k}: ${cur?"update":"create"} -> ${JSON.stringify(v).slice(0,80)}...`);
    if(APPLY){ const r=cur?await api(`/metafields/${cur.id}.json`,{method:"PUT",body:JSON.stringify({metafield:{id:cur.id,value:v,type:"single_line_text_field"}})}):await api(`/pages/${pageId}/metafields.json`,{method:"POST",body:JSON.stringify({metafield:{namespace:"global",key:k,value:v,type:"single_line_text_field"}})}); console.log("    ->",r.s,r.s>=300?JSON.stringify(r.j).slice(0,300):"ok"); }
  }
} else console.log("  (SEO metafields are set on apply, once the page exists)");

// --- link from the program page buyback section ---
const LINK_MARK='data-nesh-scrap-link="1"';
const PAGE_LINK=`<p class="nesh-bc-note" ${LINK_MARK} style="font-size:1.15rem;font-weight:700"><a href="/pages/${HANDLE}">See how the buyback works &mdash; we send you a prepaid shipping label &rarr;</a></p>`;
const prog=JSON.parse(fs.readFileSync(path.join(OUT,"page__program.json"),"utf8"));
if(prog.body_html.includes(LINK_MARK)) console.log(`program page ${prog.id}: already links to scrap page, skip`);
else {
  const s=prog.body_html.indexOf('<section id="nesh-buy-cat"'); const e=s<0?-1:prog.body_html.indexOf('</section>',s);
  if(e<0){console.log("program page: #nesh-buy-cat section not found (run buyback_offer.mjs first)");process.exit(1);}
  const nb=prog.body_html.slice(0,e)+"\n    "+PAGE_LINK+"\n  "+prog.body_html.slice(e);
  console.log(`program page ${prog.id}: add link inside #nesh-buy-cat (${prog.body_html.length} -> ${nb.length})`);
  if(APPLY){const r=await api(`/pages/${prog.id}.json`,{method:"PUT",body:JSON.stringify({page:{id:prog.id,body_html:nb}})}); console.log("  PUT program page:",r.s,r.s===200?"ok":JSON.stringify(r.j).slice(0,300));}
}
// --- link from the product blurbs ---
const PROD_LINK=` <a ${LINK_MARK} href="/pages/${HANDLE}">How the buyback works, including the prepaid shipping label &rarr;</a>`;
for(const b of PRODUCTS){
  const f=path.join(OUT,`product__${b}-wood-chipper-catalytic-converter-rebuild.json`); if(!fs.existsSync(f)){console.log(`${b}: no pulled JSON, skip`);continue;}
  const p=JSON.parse(fs.readFileSync(f,"utf8"));
  if(p.body_html.includes(LINK_MARK)){console.log(`${b}: already links to scrap page, skip`);continue;}
  const anchor='Wood chipper converters only.</p>'; const i=p.body_html.indexOf(anchor);
  if(i<0){console.log(`${b}: buyback blurb not found (run buyback_offer.mjs first)`);continue;}
  const nb=p.body_html.slice(0,i)+'Wood chipper converters only.'+PROD_LINK+'</p>'+p.body_html.slice(i+anchor.length);
  console.log(`${b} ${p.id}: add link to buyback blurb (${p.body_html.length} -> ${nb.length})`);
  if(APPLY){const r=await api(`/products/${p.id}.json`,{method:"PUT",body:JSON.stringify({product:{id:p.id,body_html:nb}})}); console.log("  PUT product:",r.s,r.s===200?"ok":JSON.stringify(r.j).slice(0,300));}
}
