/* Price Tracker v129 — data-safe Product Repair operations. Pure; no persistence. */
(function (root) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  const text = x => String(x == null ? '' : x).trim();
  const sameSpec = (a,b) => text(a?.unit) === text(b?.unit) && Math.abs(Number(a?.standardQuantity) - Number(b?.standardQuantity)) < .000001;
  const matchesObs = (o,p) => text(o?.unit) === text(p?.unit) && Math.abs(Number(o?.quantity) - Number(p?.standardQuantity)) < .000001;
  function validate(data, intent) {
    const products = Array.isArray(data?.products) ? data.products : [];
    const observations = Array.isArray(data?.observations) ? data.observations : [];
    const mode = text(intent?.mode);
    if (!['merge','split','move'].includes(mode)) throw Error('不支援此整理方式');
    const sourceId = text(intent?.sourceId), targetId = text(intent?.targetId);
    const source = products.find(p => p.id === sourceId);
    if (!source || source.mergedIntoProductId) throw Error('原產品不存在或已封存');
    if (mode !== 'split' || !intent.newProduct) {
      if (!targetId || sourceId === targetId) throw Error('請選擇另一件目標產品');
    }
    const target = targetId ? products.find(p => p.id === targetId) : null;
    if (!intent.newProduct && (!target || target.mergedIntoProductId)) throw Error('目標產品不存在或已封存');
    const sourceObs = observations.filter(o => o.productId === sourceId);
    const ids = mode === 'merge' ? sourceObs.map(o => o.id) : [...new Set((intent.observationIds || []).map(text))];
    if (mode !== 'merge' && !ids.length) throw Error('請至少選擇一筆價格紀錄');
    if (mode === 'move' && ids.length !== 1) throw Error('單筆移動只能選擇一筆紀錄');
    const selected = ids.map(id => sourceObs.find(o => o.id === id));
    if (selected.some(o => !o) || ids.length !== selected.length) throw Error('價格紀錄已更改，請重新檢查');
    if (mode === 'merge' && (!sameSpec(source,target) || text(source.salesUnit) !== text(target.salesUnit))) {
      throw Error('兩件產品容量、單位或銷售單位不同，不可合併。請改用拆分。');
    }
    const specTarget = intent.newProduct ? intent.newProduct : target;
    if (selected.some(o => !matchesObs(o,specTarget))) {
      throw Error('選取嘅價格紀錄容量或單位與目標產品不同，請先核對，唔會自動改寫歷史規格。');
    }
    if (intent.newProduct) {
      const draft = intent.newProduct;
      if (mode !== 'split' || targetId || !text(draft.name) || !Number.isFinite(Number(draft.standardQuantity)) || Number(draft.standardQuantity)<=0 || !text(draft.unit)) {
        throw Error('新產品名稱、容量或單位無效');
      }
      if (products.some(p => p.id === text(draft.id))) throw Error('新產品 ID 已存在');
    }
    return { mode, source, target, selected, ids };
  }
  function apply(data, intent, at) {
    const check = validate(data,intent);
    if (!text(at)) throw Error('缺少操作時間');
    const next=copy(data); next.meta = next.meta || {};
    const source = next.products.find(p=>p.id===check.source.id);
    let target = check.target && next.products.find(p=>p.id===check.target.id);
    const targetCreated = !!intent.newProduct;
    if (targetCreated) {
      target=copy(intent.newProduct);
      target.createdAt=at; target.updatedAt=at;
      target.barcodes=[]; target.barcode=''; target.productImageKey=''; target.productImageUpdatedAt='';
      delete target.mergedIntoProductId;
      next.products.push(target);
    }
    const changes=check.selected.map(original=>({id:original.id,previousProductId:original.productId,previousUpdatedAt:original.updatedAt || '',previousBarcode:original.barcode || ''}));
    const targetBefore=targetCreated ? null : {updatedAt:target.updatedAt||''};
    const sourceBefore={updatedAt:source.updatedAt||'',mergedIntoProductId:source.mergedIntoProductId||''};
    for(const change of changes) {
      const ob=next.observations.find(o=>o.id===change.id);
      ob.productId=target.id;
      ob.updatedAt=at;
      // Preserve original receipt / barcode evidence as historical data.
    }
    source.updatedAt=at;
    target.updatedAt=at;
    if(check.mode==='merge') source.mergedIntoProductId=target.id; // Keep original product / photo / barcode for undo.
    const history=Array.isArray(next.meta.productRepairHistory)?next.meta.productRepairHistory:[];
    const record={id:text(intent.operationId),mode:check.mode,at,sourceId:source.id,targetId:target.id,
      targetCreated,sourceBefore,targetBefore,changes,status:'active'};
    if(!record.id || history.some(x=>x.id===record.id)) throw Error('整理操作 ID 無效或重複');
    history.push(record);
    next.meta.productRepairHistory=history.slice(-40);
    return {data:next,record};
  }
  function undo(data,operationId,at) {
    const next=copy(data),hist=next.meta?.productRepairHistory;
    const records=Array.isArray(hist)?hist:[];
    const last=records[records.length-1];
    if(!last || last.status!=='active' || last.id!==operationId) throw Error('只能撤銷最近一次尚未撤銷嘅整理');
    const source=next.products.find(p=>p.id===last.sourceId),target=next.products.find(p=>p.id===last.targetId);
    if(!source||!target || source.updatedAt!==last.at || target.updatedAt!==last.at) throw Error('整理後產品已修改，為免覆蓋新資料，請手動核對');
    for(const change of last.changes) {
      const obs=next.observations.find(o=>o.id===change.id);
      if(!obs || obs.productId!==last.targetId || obs.updatedAt!==last.at) throw Error('價格紀錄其後已變更，不能自動復原');
    }
    if(last.targetCreated) {
      const existing=next.observations.filter(o=>o.productId===last.targetId);
      if(existing.length!==last.changes.length) throw Error('新產品已有其他價格，不能刪除及撤銷');
    }
    for(const change of last.changes) {
      const obs=next.observations.find(o=>o.id===change.id);
      obs.productId=change.previousProductId;obs.updatedAt=change.previousUpdatedAt;obs.barcode=change.previousBarcode;
    }
    source.updatedAt=last.sourceBefore.updatedAt;
    if(last.sourceBefore.mergedIntoProductId) source.mergedIntoProductId=last.sourceBefore.mergedIntoProductId;
    else delete source.mergedIntoProductId;
    if(last.targetCreated) next.products=next.products.filter(p=>p.id!==last.targetId);
    else target.updatedAt=last.targetBefore.updatedAt;
    last.status='undone';last.undoneAt=at;
    return {data:next,record:last};
  }
  const api={validate,apply,undo,sameSpec,matchesObs};
  root.PriceTrackerProductRepairService=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
