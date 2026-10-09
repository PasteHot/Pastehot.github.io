/* Order inbox has no database side effects. Reviewed IDs are scoped to the signed-in user. */
(function(root){
  'use strict';
  class OrderInbox {
    constructor({onChange=()=>{},onNew=()=>{},now=()=>Date.now(),reviewed=[]}={}){
      this.onChange=onChange;this.onNew=onNew;this.now=now;
      this.reviewed=new Set(reviewed);this.seen=new Set();this.pending=new Map();this.ready=false;
    }
    eligible(o){return !!o?.id&&['nuevo','pendiente_confirmacion'].includes(o.order_status)&&Number.isFinite(Date.parse(o.created_at))&&Date.parse(o.created_at)>=this.now()-48*3600000;}
    receive(o,{quiet=false}={}){
      if(!o?.id)return;
      const id=String(o.id),fresh=!this.seen.has(id);this.seen.add(id);
      if(this.eligible(o)&&!this.reviewed.has(id)){
        this.pending.set(id,o);if(fresh&&!quiet)this.onNew(o);
      }else this.pending.delete(id);
      this.onChange(this.list());
    }
    reconcile(rows){
      const initial=!this.ready;this.ready=true;
      const existing=new Set(rows.map(o=>String(o.id)));
      for(const id of this.pending.keys())if(!existing.has(id))this.pending.delete(id);
      for(const o of rows)this.receive(o,{quiet:initial});
      this.onChange(this.list());
    }
    remove(id){this.pending.delete(String(id));this.onChange(this.list());}
    review(id){id=String(id);this.reviewed.add(id);this.pending.delete(id);this.onChange(this.list());return [...this.reviewed].slice(-2000);}
    list(){return [...this.pending.values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));}
  }
  function groupProducts(products,categories){
    const names=[...new Set(categories.filter(c=>typeof c==='string'&&c.trim()))];
    for(const p of products){const c=p.category||'Sin categoría';if(!names.includes(c))names.push(c);}
    return names.map(name=>({name,products:products.filter(p=>(p.category||'Sin categoría')===name)})).filter(g=>g.products.length);
  }
  root.PasteHotOrders={OrderInbox,groupProducts};
  if(typeof module==='object')module.exports=root.PasteHotOrders;
})(typeof window==='undefined'?globalThis:window);
