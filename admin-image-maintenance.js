/* Compression staging is local. Preview never replaces production photographs. */
let stagedImages=[],imageMaintenanceBusy=false;
async function prepareImageMaintenance(){
 if(!reportOwner()||imageMaintenanceBusy)return;imageMaintenanceBusy=true;stagedImages.forEach(i=>URL.revokeObjectURL(i.preview));stagedImages=[];
 const area=document.getElementById('imageMaintenanceResults');area.innerHTML='<p>Revisando fotografías. Las imágenes originales se conservan.</p>';
 try{
 if(window.PasteHotDemo){area.textContent='No hay fotografías preparadas disponibles.';return;}
 const user=adminSession.user.id,{data:settings,error}=await db.from('settings').select('key,value').in('key',['cover_image','profile_image','background_image']);if(error)throw error;
 const refs=[...products.filter(p=>p.image_url).map(p=>({url:p.image_url,label:p.name,role:'product',table:'products',id:p.id,key:'image_url'})),...(settings||[]).filter(s=>s.value).map(s=>({url:s.value,label:{cover_image:'Portada',profile_image:'Imagen de perfil',background_image:'Fondo'}[s.key],role:{cover_image:'cover',profile_image:'profile',background_image:'background'}[s.key],table:'settings',id:s.key,key:'value'}))];
 const grouped=new Map();refs.forEach(r=>{if(!grouped.has(r.url))grouped.set(r.url,[]);grouped.get(r.url).push(r);});let reviewed=0,skipped=0;
 for(const [url,links] of grouped){if(!reportOwner()||adminSession.user.id!==user)throw new Error('SESION_CAMBIO');if(!storagePathFromPublicUrl(url)){skipped++;continue;}
 const response=await fetch(url);if(!response.ok)throw new Error('No se pudo leer una fotografía.');const original=await response.blob();reviewed++;if(original.size<500000||/png|gif|svg/.test(original.type)){skipped++;continue;}
 // Shared images use the largest preset among their references.
 const role=links.some(r=>r.role==='cover')?'cover':links.some(r=>r.role==='background')?'background':links.some(r=>r.role==='product')?'product':'profile';
 const presets={product:[1000,1000,.8],cover:[1920,1080,.82],profile:[800,800,.82],background:[1600,1600,.8]};
 const optimized=await optimizeImage(new File([original],'original',{type:original.type}),...presets[role]);if(optimized.size>=original.size*.9){skipped++;continue;}
 stagedImages.push({url,links,label:links.map(r=>r.label).join(' / '),original:original.size,file:optimized,preview:URL.createObjectURL(optimized),role});}
 if(!reportOwner()||adminSession.user.id!==user)throw new Error('SESION_CAMBIO');
 const saved=stagedImages.reduce((n,i)=>n+i.original-i.file.size,0);area.innerHTML=`<p>${reviewed} imágenes revisadas · ${stagedImages.length} versiones preparadas · Reducción estimada ${(saved/1000000).toFixed(2)} MB. Las originales siguen intactas.</p>${stagedImages.map(i=>`<div class="image-maintenance-row"><img src="${escapeAttr(i.preview)}" alt="${escapeAttr(i.label)}"><div><strong>${escapeHtml(i.label)}</strong><p>${(i.original/1000).toFixed(0)} KB → ${(i.file.size/1000).toFixed(0)} KB</p></div></div>`).join('')}${stagedImages.length?'<button class="btn btn-light" onclick="downloadOptimizedPhotos()">Descargar versiones preparadas</button>':''}<p class="media-note">La revisión no sube archivos, cambia enlaces ni borra fotografías. Los logos y archivos con transparencia se conservan. Las nuevas fotos que subas se optimizan automáticamente antes de guardarse.</p>`;
 }catch{stagedImages.forEach(i=>URL.revokeObjectURL(i.preview));stagedImages=[];area.innerHTML='<div class="message error">No se pudo completar la revisión. Las fotografías del negocio se conservaron.</div>';}finally{imageMaintenanceBusy=false;}}
async function downloadOptimizedPhotos(){if(!reportOwner()||!stagedImages.length)return;const files={};for(let n=0;n<stagedImages.length;n++)files[`PasteHot-imagen-${n+1}.webp`]=new Uint8Array(await stagedImages[n].file.arrayBuffer());files['referencias.json']=JSON.stringify(stagedImages.map((i,n)=>({archivo:`PasteHot-imagen-${n+1}.webp`,referencias:i.links.map(r=>({tabla:r.table,id:r.id,campo:r.key})),original:i.url})),null,2);if(!reportOwner())return;downloadReportFile(reportZip(files),'application/zip',`PasteHot-fotos-optimizadas-${localReportDay()}.zip`);}
function resetImageMaintenance(){stagedImages.forEach(i=>URL.revokeObjectURL(i.preview));stagedImages=[];document.getElementById('imageMaintenanceResults').textContent='';}
