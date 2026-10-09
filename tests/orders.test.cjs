const test=require('node:test'),assert=require('node:assert/strict');
const {OrderInbox,groupProducts}=require('../admin-orders.js');
const now=Date.parse('2026-10-09T18:00:00Z');
const row=(id,extra={})=>({id,order_code:id,order_status:'pendiente_confirmacion',created_at:new Date(now).toISOString(),...extra});
test('Quiet initial pending queue, unique consecutive inserts, updates and cancellation',()=>{
 let bells=0;const inbox=new OrderInbox({now:()=>now,onNew:()=>bells++});
 inbox.reconcile([row('old')]);assert.equal(bells,0);assert.equal(inbox.list().length,1);
 inbox.receive(row('one'));inbox.receive(row('one'));inbox.receive(row('two'));inbox.receive(row('three'));assert.equal(bells,3);assert.equal(inbox.list().length,4);
 inbox.receive(row('one',{order_status:'confirmado'}));assert.equal(inbox.list().length,3);
 inbox.receive(row('two',{order_status:'cancelado'}));assert.equal(inbox.list().length,2);
 inbox.reconcile([row('old'),row('three'),row('one',{order_status:'confirmado'})]);assert.equal(bells,3);
});
test('Reconnect detects orders missed while offline; reviewed orders do not return',()=>{
 let bells=0;const inbox=new OrderInbox({now:()=>now,onNew:()=>bells++});
 inbox.reconcile([row('old')]);inbox.review('old');inbox.reconcile([row('old'),row('offline')]);
 assert.equal(bells,1);assert.deepEqual(inbox.list().map(o=>o.id),['offline']);
 const reviewed=inbox.review('offline');const reloaded=new OrderInbox({now:()=>now,reviewed});
 reloaded.reconcile([row('old'),row('offline')]);assert.equal(reloaded.list().length,0);
});
test('Realtime insert before initial fetch is not lost or sounded twice',()=>{
 let bells=0;const inbox=new OrderInbox({now:()=>now,onNew:()=>bells++});inbox.receive(row('race'));inbox.reconcile([row('race')]);assert.equal(bells,1);assert.equal(inbox.list().length,1);
});
test('Only current new/pending orders alert; grouping follows configured categories and keeps orphan products',()=>{
 const inbox=new OrderInbox({now:()=>now});inbox.reconcile([row('old',{created_at:new Date(now-49*3600000).toISOString()}),row('delivered',{order_status:'entregado'}),row('current')]);assert.deepEqual(inbox.list().map(o=>o.id),['current']);
 const products=[{name:'A',category:'Salados'},{name:'B',category:'Temporada'},{name:'C',category:'Salados'},{name:'D',category:'Nueva'},{name:'E'}];
 const groups=groupProducts(products,['Temporada','Salados','Vacía','Salados']);assert.deepEqual(groups.map(g=>g.name),['Temporada','Salados','Nueva','Sin categoría']);assert.deepEqual(groups[1].products.map(p=>p.name),['A','C']);assert.equal(groups.flatMap(g=>g.products).length,5);
});
