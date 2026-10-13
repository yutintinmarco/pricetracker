/* Price Tracker v128 Phase 2 — bilingual receipt hints, store review and LOCAL candidate matching.
 * Pure browser/Node JavaScript. Does not write data or call network services.
 * Receipt labels, inferred brands and aliases are UNTRUSTED hints, never product IDs.
 */
(function (root) {
  'use strict';
  const FORMAT = 'price-tracker-receipt';
  const VERSION = 1;
  const MAX_ITEMS = 250;
  const MAX_TEXT = 240;
  const STOP = new Set(['a','the','and','of','味','產品','食品','日本','包裝','件','包','盒','樽','個','支','袋','合','pack','pcs','piece','bottle']);
  const ALIASES = [
    ['午後の紅茶', 'afternoontea'], ['午後紅茶', 'afternoontea'], ['午後红茶', 'afternoontea'],
    ['檸檬茶','lemontea'], ['柠檬茶','lemontea'], ['レモンティー','lemontea'], ['lemon tea','lemontea'],
    ['キリン','kirin'], ['麒麟','kirin'], ['kirin','kirin'],
    ['百力滋','pretz'], ['プレッツ','pretz'], ['pretz','pretz'],
    ['固力果','glico'], ['グリコ','glico'], ['glico','glico'],
    ['家庭裝','familypack'], ['家庭装','familypack'], ['ファミリーパック','familypack'], ['family pack','familypack'],
    ['沙律味','salad'], ['サラダ味','salad'], ['サラダ','salad'], ['salad','salad'],
    ['品客','pringles'], ['プリングルズ','pringles'], ['pringles','pringles'],
    ['酸忌廉','sourcream'], ['サワークリーム','sourcream'], ['sour cream','sourcream'],
    ['洋蔥','onion'], ['洋葱','onion'], ['オニオン','onion'], ['onion','onion'],
    ['日清','nissin'], ['ニッシン','nissin'], ['nissin','nissin'],
    ['生茶','namacha'], ['なまちゃ','namacha'],
    ['ラ王','raoh'], ['ra-oh','raoh'], ['raoh','raoh'],
    ['正麵','seimen'], ['正麺','seimen'], ['seimen','seimen'],
    ['東洋水產','maruchan'], ['東洋水産','maruchan'], ['maruchan','maruchan'],
    ['醬油','soysauce'], ['醤油','soysauce'], ['しょうゆ','soysauce'], ['shoyu','soysauce'],
    ['明太子','mentaiko'], ['カルボナーラ','carbonara'], ['カルボナー','carbonara'], ['卡邦尼','carbonara'], ['carbonara','carbonara'],
    ['薯片','chips'], ['ポテトチップス','chips'], ['potato chips','chips'],
    ['芝士','cheese'], ['チーズ','cheese'], ['cheese','cheese']
  ].sort((a, b) => b[0].length - a[0].length);
  const CJK = /[\p{L}\p{N}]/u;
  function s(value) { return String(value ?? '').trim().slice(0, MAX_TEXT); }
  function folded(value) { return s(value).normalize('NFKC').toLowerCase(); }
  function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function terms(value) {
    let t = folded(value);
    // Remove explicit dimension/count tokens before textual scoring.
    t = t.replace(/\b\d+(?:\.\d+)?\s*(?:ml|l|kg|g|pcs|pc|p|包|個|件|本|箱)\b/gi, ' ');
    for (const [alias, canonical] of ALIASES) {
      t = t.replace(new RegExp(escapeRegExp(alias), 'g'), ` ${canonical} `);
    }
    const tokens = (t.match(/[\p{Script=Han}]+|[\p{Script=Hiragana}\p{Script=Katakana}ー]+|[a-z0-9]+/gu) || []);
    return [...new Set(tokens.filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t)))];
  }
  function spec(rawAmount, rawUnit) {
    const amount = Number(rawAmount);
    let unit = folded(rawUnit).replace(/\s/g, '');
    if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;
    if (unit === 'l' || unit === 'liter' || unit === 'litre') return {dimension:'volume', amount: amount * 1000};
    if (unit === 'ml') return {dimension:'volume', amount};
    if (unit === 'kg') return {dimension:'weight', amount:amount * 1000};
    if (unit === 'g') return {dimension:'weight', amount};
    if (['pcs','pc','p','件','個'].includes(unit)) return {dimension:'count', amount};
    if (['pack','包'].includes(unit)) return {dimension:'packs', amount};
    return {dimension:unit, amount};
  }
  function findPrintedSpec(text) {
    const t = folded(text);
    const hits = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g|pcs|pc|p)(?![a-z])/gi)];
    if (hits.length !== 1) return null;
    return spec(hits[0][1], hits[0][2]);
  }
  function specResult(query, product) {
    if (!query) return 'missing';
    if (!product) return 'unknown';
    if (query.dimension !== product.dimension) return 'conflict';
    return Math.abs(query.amount - product.amount) < 0.0001 ? 'match' : 'conflict';
  }
  function numeric(value, label, {allowZero = false} = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
      throw new Error(`${label} 必須係有效正數。`);
    return value;
  }
  function optionalNum(value, label) {
    return value === undefined || value === null ? null : numeric(value, label, {allowZero:true});
  }
  function receiptValidDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const [yy, mm, dd] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    return dt.getUTCFullYear() === yy && dt.getUTCMonth() === mm - 1 && dt.getUTCDate() === dd;
  }
  function fromPilot(doc) {
    const r = doc.receipt || {}, tax = doc.tax || {}, totals = doc.totals || {};
    return {
      format: FORMAT,
      version: VERSION,
      receipt: {
        merchant: r.merchantPrinted,
        branch: r.branchPrinted,
        date: r.purchaseDate,
        time: r.purchaseTime,
        region: r.countryOrRegion,
        currency: r.currency,
        taxMode: tax.taxMode,
        subtotal: totals.subtotalBeforeTax,
        totalTax: totals.totalTax,
        total: totals.receiptTotal,
        taxGroups: [
          { rate:8, taxableBase:tax.eightPercentTaxableBase, tax:tax.eightPercentTax },
          { rate:10, taxableBase:tax.tenPercentTaxableBase, tax:tax.tenPercentTax }
        ]
      },
      items: (doc.lineItems || []).map(line => ({
        lineId:line.lineId,
        receiptName:line.receiptName,
        quantity:line.quantity,
        unitPrice:line.unitPriceBeforeTax,
        lineTotal:line.lineTotalBeforeTax,
        brand:line.provisionalBrand || '',
        brandVerified:false,
        packageQuantity:line.packageQuantity,
        packageUnit:line.packageUnit,
        reviewFlags:line.reviewFlags || [],
        kind: /レジ袋|shopping\s*bag/i.test(line.receiptName || '') ? 'non-merchandise' : 'product'
      }))
    };
  }
  function validate(input) {
    let doc = typeof input === 'string' ? JSON.parse(input) : input;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('收據 JSON 格式不正確。');
    if (doc.appId === 'barcode-price-tracker' || 'backupFormatVersion' in doc || 'data' in doc)
      throw new Error('呢份係完整備份，唔係收據匯入檔。請勿混用。');
    if (doc.fileType === 'price_tracker_receipt_extraction_draft') doc = fromPilot(doc);
    if (doc.format !== FORMAT || doc.version !== VERSION) throw new Error(`只支援 ${FORMAT} v${VERSION}。`);
    const receipt = doc.receipt || {};
    const merchant = s(receipt.merchant);
    const date = s(receipt.date);
    const currency = s(receipt.currency).toUpperCase();
    const region = s(receipt.region);
    if (!merchant || !receiptValidDate(date)) throw new Error('缺少正確商店名稱或收據日期。');
    if (!/^[A-Z]{3}$/.test(currency) || !region) throw new Error('貨幣或國家／地區無效。');
    if (!Array.isArray(doc.items) || !doc.items.length || doc.items.length > MAX_ITEMS)
      throw new Error(`收據商品數量必須介乎 1 至 ${MAX_ITEMS}。`);
    const seen = new Set();
    const items = doc.items.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 行唔係有效商品。`);
      const lineId = s(item.lineId || `L${index + 1}`);
      const name = s(item.receiptName);
      if (seen.has(lineId)) throw new Error(`重複收據行號 ${lineId}。`);
      seen.add(lineId);
      if (!name) throw new Error(`第 ${index + 1} 行商品名稱欠缺。`);
      const quantity = numeric(item.quantity, `${lineId} 數量`);
      const unitPrice = numeric(item.unitPrice, `${lineId} 單價`, {allowZero:true});
      const lineTotal = numeric(item.lineTotal, `${lineId} 行總額`, {allowZero:true});
      if (Math.abs(quantity * unitPrice - lineTotal) > 0.03)
        throw new Error(`${lineId} 件數 × 單價與行金額不一致。`);
      if (unitPrice === 0 && lineTotal === 0) throw new Error(`${lineId} 零元商品須另外核對。`);
      const kind = item.kind === 'non-merchandise' ? 'non-merchandise' : 'product';
      return {
        lineId, receiptName:name, displayName:s(item.displayName || item.nameZhHant), quantity, unitPrice, lineTotal,
        kind, brand:s(item.brand), brandVerified:item.brandVerified === true,
        variant:s(item.variant), packageQuantity:optionalNum(item.packageQuantity,`${lineId} 容量`),
        packageUnit:s(item.packageUnit), reviewFlags:Array.isArray(item.reviewFlags) ? item.reviewFlags.map(s).slice(0,12) : [],
        aliases:Array.isArray(item.aliases) ? item.aliases.map(s).slice(0,5) : []
        // Intentionally ignore any model-supplied barcode, productId, storeId or "confirmed" match.
      };
    });
    const warnings = [];
    const subtotal = optionalNum(receipt.subtotal,'收據小計');
    const total = optionalNum(receipt.total,'收據總額');
    const totalTax = optionalNum(receipt.totalTax,'收據稅額');
    const sum = items.reduce((n, i) => n + i.lineTotal, 0);
    if (subtotal != null && Math.abs(subtotal - sum) > 0.03) warnings.push('商品行總額與收據小計唔一致，需要核對。');
    if (total != null && subtotal != null && totalTax != null && Math.abs(total - subtotal - totalTax) > 0.03)
      warnings.push('收據總額與小計及稅額唔一致，需要核對。');
    const taxGroups = Array.isArray(receipt.taxGroups) ? receipt.taxGroups.map((g,i) => ({
      rate:numeric(g.rate, `稅率 ${i+1}`, {allowZero:true}),
      taxableBase:numeric(g.taxableBase, `稅基 ${i+1}`, {allowZero:true}),
      tax:numeric(g.tax,`組別稅額 ${i+1}`, {allowZero:true})
    })) : [];
    if (subtotal != null && taxGroups.length && Math.abs(taxGroups.reduce((n,g)=>n+g.taxableBase,0)-subtotal)>0.03)
      warnings.push('稅率組別稅基與收據小計不一致。');
    if (totalTax != null && taxGroups.length && Math.abs(taxGroups.reduce((n,g)=>n+g.tax,0)-totalTax)>0.03)
      warnings.push('稅率組別稅額與收據總稅額不一致。');
    return {
      format:FORMAT, version:VERSION,
      receipt:{merchant,merchantDisplayName:s(receipt.merchantDisplayName),branch:s(receipt.branch),branchDisplayName:s(receipt.branchDisplayName),date,time:s(receipt.time),region,currency,
        taxMode:['inclusive','exclusive','unknown'].includes(receipt.taxMode) ? receipt.taxMode : 'unknown',
        subtotal,totalTax,total,taxGroups},
      items, warnings
    };
  }
  // Store matching is advisory only. Receipt country/currency never mutate a saved store.
  function normalizedStore(value) {
    return folded(value).replace(/ジャパンミート/g,'japan meat')
      .replace(/ジャパンミ－ト/g,'japan meat').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  }
  function searchStores(query, stores) {
    const phrase = normalizedStore(query);
    if (!phrase) return [];
    const words = phrase.split(' ').filter(Boolean);
    return (stores || []).filter(store => {
      const labels = [store.storeName, store.displayName].map(normalizedStore);
      return labels.some(label => label && (label.includes(phrase) || words.every(w => label.includes(w))));
    }).slice(0, 30).map(store => ({
      id:store.id||store.storeId,name:store.displayName||store.storeName,
      region:store.countryOrRegion||'', currency:store.defaultCurrency||''
    }));
  }
  function findStore(receipt, stores) {
    const merchant=normalizedStore(receipt.merchant), localized=normalizedStore(receipt.merchantDisplayName), branch=folded(receipt.branch);
    const options=(stores||[]).map(store => {
      const raw=[store.storeName,store.displayName].map(normalizedStore);
      const nameHit=raw.some(x => x && ((merchant.length >= 4 && (x===merchant || merchant.includes(x) || x.includes(merchant))) || (localized.length >= 4 && (x===localized || localized.includes(x) || x.includes(localized)))));
      if (!nameHit) return null;
      const sameRegion = store.countryOrRegion === receipt.region;
      const sameCurrency = store.defaultCurrency === receipt.currency;
      return {id:store.id||store.storeId,name:store.displayName||store.storeName,
        region:store.countryOrRegion,currency:store.defaultCurrency,
        regionConflict:!sameRegion,currencyConflict:!sameCurrency,
        branchHint:branch,score:100-(sameRegion?0:40)-(sameCurrency?0:15)};
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    return options.slice(0,5);
  }
  function scoreCandidate(item, p) {
    const allInput=[...new Set([...terms(item.receiptName), ...terms(item.displayName), ...terms(item.aliases.join(' ')), ...terms(item.brand), ...terms(item.variant)])];
    const nameTokens=terms(`${p.name||''} ${p.variant||''}`);
    const productBrand=terms(p.brand||'');
    const allProduct=new Set([...nameTokens,...productBrand]);
    const overlap=allInput.filter(token=>allProduct.has(token));
    if (overlap.length === 0) return null;
    const substantive=overlap.filter(t => t.length>2 && t!=='chips' && t!=='cheese' && t!=='salad' && t!=='soysauce' && t!=='carbonara');
    const bInput=terms(item.brand), bProduct=productBrand;
    const brandMatch=bInput.length>0 && bInput.some(x=>bProduct.includes(x));
    const brandUsedAsSeries=bInput.length>0 && bInput.some(x=>nameTokens.includes(x));
    const brandConflict=item.brandVerified && bInput.length>0 && !brandMatch && !brandUsedAsSeries && bProduct.length>0;
    const vs=terms(item.variant), pv=terms(p.variant||'');
    const variantConflict=vs.length>0 && pv.length>0 && !vs.some(x=>pv.includes(x));
    const printedSpec=spec(item.packageQuantity,item.packageUnit) || findPrintedSpec(item.receiptName);
    const productSpec=spec(p.standardQuantity,p.unit);
    const size=specResult(printedSpec,productSpec);
    const overlapCoverage=overlap.length/Math.max(allInput.length,1);
    const nameCoverage=overlap.filter(x=>nameTokens.includes(x)).length/Math.max(nameTokens.length,1);
    let points=10 + Math.round(34*overlapCoverage + 14*nameCoverage);
    if (brandMatch) points+=16;
    if (brandUsedAsSeries) points+=9;
    if (size==='match') points+=28;
    if (size==='conflict') points-=28;
    if (brandConflict || variantConflict) points-=35;
    if (item.reviewFlags.includes('name_truncated')) points-=8;
    points=Math.max(0,Math.min(100,points));
    const conflicts=[];
    if(size==='conflict')conflicts.push('容量／單位衝突');
    if(brandConflict)conflicts.push('品牌衝突');
    if(variantConflict)conflicts.push('款式衝突');
    return {productId:p.id||p.productId,productName:`${p.brand?`${p.brand} `:''}${p.name||''}${p.variant?`（${p.variant}）`:''}`,
      standardQuantity:p.standardQuantity,unit:p.unit,score:points,overlap,size,conflicts,
      evidence:{brandMatched:brandMatch,seriesBrand:brandUsedAsSeries,nameTokens:overlap.length,spec:size}};
  }
  function match(doc, products, stores = [], confirmedAliases = []) {
    const receipt = validate(doc);
    const storeCandidates=findStore(receipt.receipt,stores);
    const results=receipt.items.map(item=>{
      if(item.kind==='non-merchandise') return {...item,status:'skip',candidates:[],recommendedProductId:null,selectedProductId:null};
      const shortlist=(products||[]).map(p=>scoreCandidate(item,p)).filter(x=>x&&x.score>=20)
        .sort((a,b)=>b.score-a.score).slice(0,5);
      const merchantKey=folded(receipt.receipt.merchant);
      const alias=(confirmedAliases||[]).find(a=>a.confirmed===true && folded(a.merchant)===merchantKey &&
        (!a.region || a.region===receipt.receipt.region) && folded(a.receiptName)===folded(item.receiptName));
      if(alias) {
        const known=(products||[]).find(p=>(p.id||p.productId)===alias.productId);
        if(known && !shortlist.some(x=>x.productId===alias.productId)) {
          const scored=scoreCandidate(item,known);
          if(scored && !scored.conflicts.length) shortlist.unshift(scored);
        }
      }
      const top=shortlist[0];
      const runnerUp=shortlist[1];
      const aliasOK = !!(alias && top && top.productId===alias.productId && !top.conflicts.length && top.size!=='conflict');
      const strong = !!(top && !top.conflicts.length && top.size==='match' && top.score>=70 &&
        top.evidence.nameTokens>=2 && (!runnerUp || top.score-runnerUp.score>=12));
      const recommend = strong || aliasOK;
      return {...item,status: recommend?'suggested':shortlist.length?'review':'unmatched',
        recommendedProductId:recommend?top.productId:null,selectedProductId:null,
        candidates:shortlist,matchedViaConfirmedAlias:aliasOK};
    });
    const grouped=results.reduce((acc,item)=>{
      if(item.kind==='non-merchandise')return acc;
      const key=`${folded(item.receiptName)}|${item.unitPrice}|${folded(item.brand)}|${item.packageQuantity||''}${item.packageUnit||''}`;
      (acc[key]||(acc[key]=[])).push(item.lineId);
      return acc;
    },{});
    return {receipt:receipt.receipt,warnings:receipt.warnings,storeCandidates,
      items:results.map(item=>({...item,duplicateLines:Object.values(grouped).find(ids=>ids.length>1 && ids.includes(item.lineId))||[]})),
      summary:{lines:results.length,productLines:results.filter(x=>x.kind==='product').length,
        suggested:results.filter(x=>x.status==='suggested').length,
        review:results.filter(x=>x.status==='review').length,
        unmatched:results.filter(x=>x.status==='unmatched').length,
        skipped:results.filter(x=>x.status==='skip').length}}
  }
  function searchProducts(query, products) {
    const words=terms(query);
    const raw=folded(query);
    if(!words.length && !raw) return [];
    const printed=findPrintedSpec(query);
    return (products||[]).map(p=>{
      const text=`${p.brand||''} ${p.name||''} ${p.variant||''}`;
      const pterms=terms(text);
      const t=folded(text);
      const hits=words.filter(w=>pterms.includes(w));
      const exact=raw.length>=2 && t.includes(raw);
      if(!hits.length && !exact) return null;
      const size=specResult(printed,spec(p.standardQuantity,p.unit));
      return {productId:p.id||p.productId,productName:`${p.brand||''} ${p.name||''} ${p.variant||''}`.trim(),
        standardQuantity:p.standardQuantity,unit:p.unit,size,
        score:(exact?50:0)+hits.length*12+(size==='match'?20:0)-(size==='conflict'?30:0)};
    }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,20);
  }
  root.PriceTrackerReceiptImportService=Object.freeze({FORMAT,VERSION,validate,match,terms,findPrintedSpec,findStore,searchStores,searchProducts});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.PriceTrackerReceiptImportService;
})(typeof window!=='undefined'?window:globalThis);
