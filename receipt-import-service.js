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
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(lineId)) throw new Error(`第 ${index+1} 行的識別編號無效。`);
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
        promotionNotes:s(item.promotionNotes),
        priceNature:['standard','special-promotion'].includes(item.priceNature)?item.priceNature:'standard',
        kind, taxRate:item.taxRate===undefined||item.taxRate===null?null:numeric(item.taxRate,`${lineId} 稅率`,{allowZero:true}), brand:s(item.brand), brandVerified:item.brandVerified === true,
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
      receipt:{merchant,merchantDisplayName:s(receipt.merchantDisplayName),branch:s(receipt.branch),branchDisplayName:s(receipt.branchDisplayName),
        reference:s(receipt.reference||receipt.receiptNumber||receipt.transactionId),date,time:s(receipt.time),region,currency,
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
  // v128 Phase 3 — local-only preflight, tax allocation and idempotent import planning.
  // No state writes: the UI commits the complete result using dataService.importAtomically.
  const moneyScale = code => code === 'JPY' || code === 'KRW' ? 1 : 100;
  const sameMoney = (a,b,scale) => Math.abs(Math.round(a*scale)-Math.round(b*scale)) <= 0.5;
  function canonicalReceiptText(value) { return folded(value).replace(/\s+/g,' ').trim(); }
  function hashFingerprint(value) {
    let h1=0x811c9dc5, h2=5381;
    for(const char of value) {
      const code=char.codePointAt(0);
      h1=Math.imul(h1^code,0x01000193)>>>0;
      h2=((Math.imul(h2,33)>>>0)^code)>>>0;
    }
    return `${h1.toString(16).padStart(8,'0')}${h2.toString(16).padStart(8,'0')}`;
  }
  function receiptIdentity(report) {
    const r=report.receipt;
    const perLine=item=>[item.kind,canonicalReceiptText(item.receiptName),item.quantity,item.unitPrice,item.lineTotal].join('|');
    const stableReference=canonicalReceiptText(r.reference||'');
    const key=[canonicalReceiptText(r.merchant),canonicalReceiptText(r.branch),r.date,r.time||'',r.region,r.currency,
      ...(stableReference?[stableReference]:[r.subtotal??'',r.total??'',r.totalTax??'',...report.items.map(perLine).sort()])].join('\n');
    const receiptKey=`receipt_${hashFingerprint(key)}`;
    const counts=new Map();
    const lineKeys={};
    for(const item of report.items) {
      const k=perLine(item);
      const occurrence=(counts.get(k)||0)+1;
      counts.set(k,occurrence);
      lineKeys[item.lineId]=`${receiptKey}_${hashFingerprint(`${k}|${occurrence}`)}`;
    }
    return {receiptKey,lineKeys};
  }
  function groupTaxAllocation(report, overrides={}) {
    const receipt=report.receipt, items=report.items, scale=moneyScale(receipt.currency);
    const allocations=Object.fromEntries(items.map(item=>[item.lineId,0]));
    if(receipt.taxMode!=='exclusive') return {allocations,errors:[]};
    const errors=[];
    const groups=(receipt.taxGroups||[]).filter(g=>g.taxableBase>0 || g.tax>0);
    const declaredTax=receipt.totalTax;
    if(declaredTax==null) return {allocations,errors:['未稅收據缺少總稅額，暫不可正式匯入。']};
    if(!groups.length) {
      if(declaredTax===0) return {allocations,errors:[]};
      return {allocations,errors:['未稅收據沒有稅率組別，不能安全分配消費稅。']};
    }
    if(!sameMoney(groups.reduce((a,g)=>a+g.tax,0),declaredTax,scale))
      errors.push('稅率組別稅額與收據總稅額不符。');
    const rateForLine=new Map();
    const classified=items.map(item=>({item,explicit:overrides[item.lineId]??item.taxRate}));
    if(groups.length===1) {
      for(const {item} of classified) rateForLine.set(item.lineId,groups[0].rate);
    } else {
      for(const {item,explicit} of classified) {
        if(explicit!==null&&explicit!==undefined&&explicit!=='') {
          const rate=Number(explicit);
          if(groups.some(g=>g.rate===rate)) rateForLine.set(item.lineId,rate);
          else errors.push(`${item.lineId} 指定稅率不在收據稅率組別內。`);
        }
      }
      // Conservative inference when receipts segregate merchandise and a bag fee.
      if(rateForLine.size===0 && groups.length===2) {
        const productBase=items.filter(i=>i.kind==='product').reduce((x,i)=>x+i.lineTotal,0);
        const otherBase=items.filter(i=>i.kind!=='product').reduce((x,i)=>x+i.lineTotal,0);
        const productsGroup=groups.find(g=>sameMoney(g.taxableBase,productBase,scale));
        const otherGroup=groups.find(g=>sameMoney(g.taxableBase,otherBase,scale)&&g!==productsGroup);
        if(productBase>0 && otherBase>0 && productsGroup && otherGroup) {
          for(const item of items) rateForLine.set(item.lineId,item.kind==='product'?productsGroup.rate:otherGroup.rate);
        }
      }
    }
    for(const item of items) if(!rateForLine.has(item.lineId)) errors.push(`${item.lineId} 未能確認所屬消費稅率。`);
    if(errors.length) return {allocations,errors};
    for(const group of groups) {
      const rows=items.filter(item=>rateForLine.get(item.lineId)===group.rate);
      const sum=rows.reduce((a,i)=>a+i.lineTotal,0);
      if(!sameMoney(sum,group.taxableBase,scale)) {
        errors.push(`${group.rate}% 稅率組別商品金額 ${sum} 與稅基 ${group.taxableBase} 不符。`);
        continue;
      }
      const minorTotal=Math.round(group.tax*scale);
      if(minorTotal===0) continue;
      const shares=rows.map(item=>{
        const ideal=minorTotal*(item.lineTotal/sum);
        const floored=Math.floor(ideal+1e-10);
        return {item,minor:floored,remainder:ideal-floored};
      });
      let left=minorTotal-shares.reduce((n,v)=>n+v.minor,0);
      shares.sort((a,b)=>b.remainder-a.remainder||a.item.lineId.localeCompare(b.item.lineId));
      for(let i=0;i<shares.length&&left>0;i++,left--) shares[i].minor+=1;
      for(const row of shares) allocations[row.item.lineId]=row.minor/scale;
    }
    return {allocations,errors};
  }
  function standardUnitText(value) {
    const unit=String(value||'').trim();
    if(unit==='mL'||unit==='ML')return 'ml';
    if(unit==='件'||unit==='個')return 'pcs';
    if(unit==='包')return 'pack';
    return unit;
  }
  function comparableSpecs(item,product) {
    const receiptSpec=spec(item.packageQuantity,item.packageUnit)||findPrintedSpec(item.receiptName);
    return specResult(receiptSpec,spec(product.standardQuantity,product.unit));
  }
  function buildImportPlan({report,selections={},drafts={},storeSelection=null,products=[],stores=[],observations=[],settings={},taxOverrides={},unknownTaxAccepted=false}) {
    if(!report?.receipt||!Array.isArray(report.items)) throw new Error('缺少有效收據配對預覽。');
    const r=report.receipt,errors=[], warnings=[], scale=moneyScale(r.currency);
    const identity=receiptIdentity(report);
    if((report.warnings||[]).length) errors.push(...report.warnings);
    const existingStore=storeSelection?.mode==='existing'?stores.find(store=>(store.id||store.storeId)===storeSelection.storeId):null;
    let selectedStore=null;
    if(existingStore) {
      if(existingStore.countryOrRegion!==r.region || existingStore.defaultCurrency!==r.currency)
        errors.push('現有店舖地區／貨幣與收據不一致，請先修正店舖設定或另建正確店舖。');
      selectedStore={mode:'existing',id:existingStore.id||existingStore.storeId,name:existingStore.displayName||existingStore.storeName,region:existingStore.countryOrRegion,currency:existingStore.defaultCurrency};
    } else if(storeSelection?.mode==='draft') {
      const name=String(storeSelection.name||'').trim();
      if(!name) errors.push('新店舖名稱不可留空。');
      if(name.length>120) errors.push('新店舖名稱過長。');
      const normalized=canonicalReceiptText(name);
      if(stores.some(s=>canonicalReceiptText(s.displayName||s.storeName)===normalized && s.countryOrRegion===r.region))
        errors.push('已有同名及同地區店舖，請優先揀現有店舖。');
      selectedStore={mode:'draft',name,region:r.region,currency:r.currency};
    } else errors.push('請先配對或新增店舖。');
    const validRegions=(settings.regions||[]).map(v=>v.id);
    const validCurrencies=(settings.currencies||[]).map(v=>v.code);
    if(!validRegions.includes(r.region)) errors.push(`App 尚未設定收據地區：${r.region}。`);
    if(!validCurrencies.includes(r.currency)) errors.push(`App 尚未設定收據貨幣：${r.currency}。`);
    const exchangeRate=r.currency==='HKD'?1:Number((settings.currencies||[]).find(c=>c.code===r.currency)?.rateToHKD);
    if(!Number.isFinite(exchangeRate)||exchangeRate<=0) errors.push(`缺少 ${r.currency} 對港幣匯率，請先喺設定核對。`);
    if(r.taxMode==='unknown' && !unknownTaxAccepted) errors.push('未確認稅項是否已包含，須勾選「使用收據列價」才可匯入。');
    if(r.subtotal==null || r.total==null) errors.push('收據欠缺小計或總額，不能確認金額完整性。');
    const rawSum=report.items.reduce((sum,item)=>sum+item.lineTotal,0);
    if(r.subtotal!=null&&!sameMoney(rawSum,r.subtotal,scale)) errors.push('商品總額與收據小計不符，不能提交。');
    if(r.total!=null && r.subtotal!=null && r.totalTax!=null && !sameMoney(r.subtotal+r.totalTax,r.total,scale)) errors.push('收據稅額無法對數，不能提交。');
    if(r.taxMode==='inclusive' && r.total!=null && !sameMoney(rawSum,r.total,scale)) errors.push('已含稅收據明細與總額不符。');
    if(r.taxMode==='unknown' && r.total!=null && !sameMoney(rawSum,r.total,scale)) errors.push('收據列價與總額不符，未知差額無法安全處理。');
    const tax=groupTaxAllocation(report,taxOverrides);
    errors.push(...tax.errors);
    const previous=new Set(observations.map(o=>o.receiptImport?.lineKey||o.receiptImportLineKey).filter(Boolean));
    const rows=[];
    const capacityUnits=new Set((settings.capacityUnits||[]).map(u=>u.code||u.id));
    for(const item of report.items) {
      const base={lineId:item.lineId,lineKey:identity.lineKeys[item.lineId],item,receiptUnitPrice:item.unitPrice,receiptLineTotal:item.lineTotal,
        taxAllocated:tax.allocations[item.lineId]||0};
      const quantity=item.quantity;
      base.grossLineTotal=Number((item.lineTotal+base.taxAllocated).toFixed(scale===1?0:2));
      base.grossUnitPrice=base.grossLineTotal/quantity;
      if(item.kind!=='product') {rows.push({...base,status:'non-merchandise'});continue;}
      const selection=selections[item.lineId]||'';
      if(selection==='__skip__') {rows.push({...base,status:'skipped'});continue;}
      if(!selection) {rows.push({...base,status:'pending'});continue;}
      let product=null, draft=null;
      if(selection==='__new__') {
        const d=drafts[item.lineId]||{};
        draft={name:String(d.name||'').trim(),brand:String(d.brand||'').trim(),variant:String(d.variant||'').trim(),
          quantity:Number(d.quantity),unit:standardUnitText(d.unit)};
        if(!draft.name || draft.name.length>140 || !Number.isFinite(draft.quantity)||draft.quantity<=0 || !capacityUnits.has(draft.unit)) {
          rows.push({...base,status:'error',error:'新產品草稿欠缺有效名稱、規格或單位，請先核對。'});continue;
        }
        if(products.some(p=>canonicalReceiptText([p.brand,p.name,p.variant].join('|'))===canonicalReceiptText([draft.brand,draft.name,draft.variant].join('|'))&&specResult(spec(p.standardQuantity,p.unit),spec(draft.quantity,draft.unit))==='match')) {
          rows.push({...base,status:'error',error:'現有產品已經有相同名稱及規格，請優先配對現有產品。'});continue;
        }
        draft.key=canonicalReceiptText([draft.brand,draft.name,draft.variant,draft.quantity,draft.unit].join('|'));
      } else {
        product=products.find(p=>(p.id||p.productId)===selection);
        if(!product) {rows.push({...base,status:'error',error:'所選現有產品已不存在。'});continue;}
        const verifiedBrand=terms(item.brand);
        const actualBrand=terms(product.brand||'');
        if(item.brandVerified && verifiedBrand.length && actualBrand.length &&
           !verifiedBrand.some(term=>actualBrand.includes(term))) {
          rows.push({...base,status:'error',error:'收據品牌已核實，但與所選產品品牌衝突。'});continue;
        }
        const requiredVariant=terms(item.variant);
        const productVariant=terms(product.variant||'');
        if(requiredVariant.length && productVariant.length && !requiredVariant.some(term=>productVariant.includes(term))) {
          rows.push({...base,status:'error',error:'收據款式與所選產品款式衝突。'});continue;
        }
        if(comparableSpecs(item,product)==='conflict') {
          rows.push({...base,status:'error',error:'收據產品容量／數量與選擇產品不同，請更改配對。'});continue;
        }
      }
      if(previous.has(base.lineKey)) {rows.push({...base,status:'duplicate',productId:product?.id||product?.productId,draft});continue;}
      if(!Number.isFinite(base.grossUnitPrice)||base.grossUnitPrice<=0 || base.grossLineTotal<=0) {
        rows.push({...base,status:'error',error:'稅後單價無效。'});continue;
      }
      if(product && observations.some(o=>o.productId===(product.id||product.productId) && o.date===r.date && o.currency===r.currency &&
        (o.storeId===selectedStore?.id || (!o.storeId && canonicalReceiptText(o.storeNameSnapshot)===canonicalReceiptText(selectedStore?.name))) &&
        !o.receiptImport?.lineKey && Math.abs(Number(o.totalAmountPaid||o.price)-base.grossUnitPrice)<0.01))
        warnings.push(`${item.lineId}：同日期、店舖及產品有相近既有價格，請留意可能重複（不會自動刪除）。`);
      rows.push({...base,status:'ready',productId:product?.id||product?.productId,draft,
        productQuantity:product?.standardQuantity||draft.quantity,productUnit:product?.unit||draft.unit});
    }
    if(rows.some(v=>v.status==='error')) errors.push('部分已選擇商品資料不完整或規格衝突，請先修正。');
    const counts={ready:rows.filter(x=>x.status==='ready').length,skipped:rows.filter(x=>x.status==='skipped').length,
      pending:rows.filter(x=>x.status==='pending').length,duplicate:rows.filter(x=>x.status==='duplicate').length,
      error:rows.filter(x=>x.status==='error').length,newProducts:new Set(rows.filter(x=>x.status==='ready'&&x.draft).map(x=>x.draft.key)).size};
    return {receiptKey:identity.receiptKey,selectedStore,exchangeRate,rows,counts,errors,warnings,
      ready:rows.filter(x=>x.status==='ready'),totalReady:rows.filter(x=>x.status==='ready').reduce((sum,x)=>sum+x.grossLineTotal,0)};
  }

  root.PriceTrackerReceiptImportService=Object.freeze({FORMAT,VERSION,validate,match,terms,findPrintedSpec,findStore,searchStores,searchProducts,receiptIdentity,groupTaxAllocation,buildImportPlan});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.PriceTrackerReceiptImportService;
})(typeof window!=='undefined'?window:globalThis);
