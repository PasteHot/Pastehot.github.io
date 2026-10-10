/* Holds an order locally while the customer switches to WhatsApp. The order
   reaches Supabase only after the customer returns and explicitly confirms. */
(function(root){
  const KEY='pastehot_whatsapp_handoff_v1';
  const MAX_AGE_MS=45*60*1000;
  function create({storage=root.sessionStorage,now=()=>Date.now()}={}){
    let current=null,busy=false;
    function clear(){current=null;try{storage.removeItem(KEY)}catch{}}
    function restore(){
      try{
        const value=JSON.parse(storage.getItem(KEY)||'null');
        if(!value||!Number.isFinite(value.startedAt)||now()-value.startedAt>MAX_AGE_MS){clear();return null;}
        current=value;return current;
      }catch{clear();return null;}
    }
    restore();
    return {
      get current(){return current;},
      get busy(){return busy;},
      begin(draft,openWhatsApp){
        if(current||busy||!draft||typeof openWhatsApp!=='function')return false;
        const value={...draft,startedAt:now()};
        try{storage.setItem(KEY,JSON.stringify(value));}catch{return false;}
        current=value;
        openWhatsApp();
        return true;
      },
      restore,
      cancel(){if(busy)return false;clear();return true;},
      async confirm(createOrder){
        if(!current||busy||typeof createOrder!=='function')return null;
        if(now()-current.startedAt>MAX_AGE_MS){clear();return {ok:false,expired:true};}
        busy=true;
        try{
          const result=await createOrder(current);
          if(result?.ok===true)clear();
          return result;
        }finally{busy=false;}
      }
    };
  }
  root.PasteHotOrderHandoff={KEY,MAX_AGE_MS,create};
})(window);
