// Logo original preparado como bitmap ESC/POS para impresión directa, sin cargar imágenes al pulsar.
const PASTEHOT_LOGO_ESCPOS_BASE64="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";
function ticketLogoRasterBytes(){return Uint8Array.from(atob(PASTEHOT_LOGO_ESCPOS_BASE64),c=>c.charCodeAt(0))}
function ticketLogoBytes(){
  const raster=ticketLogoRasterBytes();
  const rowBytes=raster[4]+256*raster[5],width=rowBytes*8,height=raster[6]+256*raster[7];
  // ESC * imprime el mismo bitmap por columnas de 24 puntos.
  // Restablece el espaciado normal antes de continuar con el texto.
  const bytes=[27,51,24];
  for(let top=0;top<height;top+=24){
    bytes.push(27,42,33,width&255,width>>8);
    for(let x=0;x<width;x++){
      for(let block=0;block<3;block++){
        let column=0;
        for(let bit=0;bit<8;bit++){
          const y=top+block*8+bit;
          if(y<height&&(raster[8+y*rowBytes+(x>>3)]&(128>>(x&7))))column|=128>>bit;
        }
        bytes.push(column);
      }
    }
    bytes.push(10);
  }
  bytes.push(27,50);
  return new Uint8Array(bytes);
}
function hasDeliveryLocation(o){
  const lat=o.delivery_lat,lng=o.delivery_lng;
  if(lat==null||lng==null||String(lat).trim()===""||String(lng).trim()==="")return false;
  return Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180;
}
function ticketDeliveryLabel(value){return value==="delivery"?"Envío a domicilio":value==="pickup"?"Pasar a recoger":String(value||"")}
function ticketPaymentLabel(value){return value==="cash"?"Efectivo":value==="transfer"?"Transferencia":String(value||"")}
function ticketDate(value){if(!value)return"";return new Intl.DateTimeFormat("es-MX",{dateStyle:"short",timeStyle:"short"}).format(new Date(value))}
function firstCustomerName(value){
  const clean=String(value||"").trim();
  return clean?clean.split(/\s+/)[0]:"Cliente";
}
function rawBtSafeText(value){
  return String(value??"").replace(/\r/g,"").trim();
}
function rawBtMoney(value){
  return "$"+Number(value||0).toFixed(2);
}
function escPosSafeText(value){
  return String(value??"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^\x20-\x7E]/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function escPosWrap(value,width=32){
  const text=escPosSafeText(value);
  if(!text)return [""];
  const words=text.split(" ");
  const lines=[];
  let line="";
  words.forEach(word=>{
    if(word.length>width){
      if(line){lines.push(line);line=""}
      for(let i=0;i<word.length;i+=width)lines.push(word.slice(i,i+width));
      return;
    }
    if(!line){line=word}
    else if((line+" "+word).length<=width){line+=" "+word}
    else{lines.push(line);line=word}
  });
  if(line)lines.push(line);
  return lines;
}
function escPosPair(left,right,width=32){
  const l=escPosSafeText(left);
  const r=escPosSafeText(right);
  const spaces=Math.max(1,width-l.length-r.length);
  if(l.length+r.length+1<=width)return l+" ".repeat(spaces)+r;
  const keep=Math.max(1,width-r.length-1);
  return l.slice(0,keep)+" "+r;
}
function rawBtBytesToBase64(bytes){
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  }
  return btoa(binary);
}
function rawBtEscPosTicket(o,options={}){
  const items=safeItems(o.items);
  const isDelivery=o.delivery_type==="delivery";
  const customerPhone=normalizePhone(o.customer_phone||"");
  const businessPhone=normalizePhone(document.getElementById("whatsapp")?.value||"");
  const firstName=firstCustomerName(o.customer_name);
  const address=o.delivery_address_text||o.address||"Direccion no registrada";
  const reference=o.delivery_reference||"Sin referencia adicional";
  const verificationCode=o.delivery_verification_code||"----";
  const rain=Number(o.delivery_rain_surcharge)||0;
  const code=o.order_code||String(o.id||"").slice(0,8);
  const bytes=[];
  const push=(...values)=>values.forEach(v=>bytes.push(v&255));
  const write=value=>{
    const s=escPosSafeText(value);
    for(let i=0;i<s.length;i++)bytes.push(s.charCodeAt(i)&127);
  };
  const line=value=>{write(value);push(10)};
  const blank=()=>push(10);
  const align=value=>push(27,97,value);
  const bold=on=>push(27,69,on?1:0);
  const size=(w=1,h=1)=>push(29,33,((Math.max(1,Math.min(8,w))-1)<<4)|(Math.max(1,Math.min(8,h))-1));
  const rule=()=>line("--------------------------------");
  const wrapped=(value,width=32)=>escPosWrap(value,width).forEach(line);
  const pair=(left,right)=>line(escPosPair(left,right,32));
  const qr=value=>{
    const data=escPosSafeText(value);
    if(!data)return;
    const dataBytes=[];
    for(let i=0;i<data.length;i++)dataBytes.push(data.charCodeAt(i)&127);
    const storeLength=dataBytes.length+3;
    align(1);
    push(29,40,107,4,0,49,65,50,0);
    push(29,40,107,3,0,49,67,5);
    push(29,40,107,3,0,49,69,48);
    push(29,40,107,storeLength&255,(storeLength>>8)&255,49,80,48,...dataBytes);
    push(29,40,107,3,0,49,81,48);
    blank();
    align(0);
  };

  // ESC/POS: inicializa una impresora térmica estándar de 58 mm.
  push(27,64);
  align(1);
  if(options.includeLogo!==false){
    ticketLogoBytes().forEach(value=>push(value));
    blank();
  }
  bold(true);
  size(1,1);
  line("TICKET DE COMPRA");
  bold(false);
  line("FOLIO "+code);
  line(ticketDate(o.created_at));
  align(0);
  rule();

  pair("Cliente",firstName);
  pair("Telefono",customerPhone||"Sin telefono");
  pair("Modalidad",ticketDeliveryLabel(o.delivery_type));
  pair("Pago",ticketPaymentLabel(o.payment_method));
  rule();

  if(items.length){
    items.forEach(i=>{
      wrapped((i.quantity||0)+" x "+(i.name||"Producto"),32);
      pair("",rawBtMoney(i.subtotal));
    });
  }else{
    line("Sin productos registrados.");
  }

  rule();
  pair("Subtotal",rawBtMoney(o.subtotal));
  if(isDelivery&&rain>0){
    pair("Envio base",rawBtMoney(o.delivery_base_fee));
    pair("Lluvia",rawBtMoney(rain));
  }
  pair("Envio",rawBtMoney(o.delivery_fee));
  bold(true);
  size(1,2);
  pair("TOTAL",rawBtMoney(o.total));
  size(1,1);
  bold(false);

  if(o.notes){
    rule();
    bold(true);line("NOTAS");bold(false);
    wrapped(o.notes,32);
  }

  if(isDelivery){
    rule();
    align(1);bold(true);line("DATOS DE ENTREGA");bold(false);
    line("CODIGO DE ENTREGA");
    size(2,2);line(verificationCode);size(1,1);
    line("Pedir codigo antes de entregar");
    align(0);
    if(o.delivery_zone_name)pair("Zona",o.delivery_zone_name);
    bold(true);line("DIRECCION");bold(false);
    wrapped(address,32);
    bold(true);line("REFERENCIA");bold(false);
    wrapped(reference,32);
    pair("Cliente",customerPhone||"Sin telefono");
    pair("PasteHot",businessPhone||"Sin telefono");
    if(o.delivery_provider)pair("Reparto",o.delivery_provider);
    if(hasDeliveryLocation(o)){
      rule();
      align(1);
      line("UBICACION EN GOOGLE MAPS");
      qr(mapsDirectionsUrl(o.delivery_lat,o.delivery_lng));
      line("Escanea para abrir la ruta");
      align(0);
    }
  }

  rule();
  align(1);
  line("Gracias por tu compra");
  blank();
  blank();
blank();
  bold(true);line("www.pastehot.com");bold(false);
  blank();
  wrapped("(c) 2026 PasteHot es una marca registrada. Todos los derechos reservados.",32);
  blank();blank();blank();blank();
  align(0);
  return new Uint8Array(bytes);
}
function printTicketOrder(o,options={}){
  const isAndroid=/Android/i.test(navigator.userAgent||"");
  if(isAndroid&&!options.forceBrowser){
    // Mini Print + RawBT: enviamos ESC/POS de 58 mm directamente.
    // RawBT recibe los bytes en base64 y los entrega a la impresora configurada.
    const ticketBytes=rawBtEscPosTicket(o,options);
    const rawBtPayload=rawBtBytesToBase64(ticketBytes);
    // RawBT documenta el esquema rawbt:base64,<datos> para enviar bytes RAW.
    // No codificar el Base64 con encodeURIComponent: rompe +, / y =.
    window.location.href="rawbt:base64,"+rawBtPayload;
    return;
  }

  const items=safeItems(o.items);
  const itemRows=items.map(i=>`<div class="item"><div class="item-name"><strong>${escapeHtml(i.quantity)} × ${escapeHtml(i.name||"Producto")}</strong>${Number(i.price)>=0?`<small>${escapeHtml(i.quantity)} × ${formatMoney(i.price)}</small>`:""}</div><strong class="item-total">${formatMoney(i.subtotal)}</strong></div>`).join("");
  const notes=o.notes?`<div class="notes"><strong>NOTAS</strong><div>${escapeHtml(o.notes)}</div></div>`:"";
  const isDelivery=o.delivery_type==="delivery";
  const hasLocation=isDelivery&&hasDeliveryLocation(o);
  const customerPhone=normalizePhone(o.customer_phone||"");
  const businessPhone=normalizePhone(document.getElementById("whatsapp")?.value||"");
  const firstName=firstCustomerName(o.customer_name);
  const address=o.delivery_address_text||o.address||"Dirección no registrada";
  const reference=o.delivery_reference||"Sin referencia adicional";
  const verificationCode=o.delivery_verification_code||"----";
  const rain=Number(o.delivery_rain_surcharge)||0;
  const popup=options.targetWindow||window.open("","_blank","width=420,height=900");
  if(!popup){alert("El navegador bloqueó la ventana del ticket. Permite ventanas emergentes para imprimir.");return}

  popup.document.open();
  popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparando ticket…</title></head><body style="font-family:Arial,sans-serif;padding:20px"><strong>Preparando ticket de 58 mm…</strong></body></html>');
  popup.document.close();

  const writeTicket=qrSrc=>{
    const deliveryBlock=isDelivery?`
      <div class="rule"></div>
      <div class="delivery-title">DATOS DE ENTREGA</div>
      <div class="verify">
        <div class="verify-label">Código de entrega</div>
        <div class="verify-code">${escapeHtml(verificationCode)}</div>
        <div class="verify-note">El repartidor debe pedir este código antes de entregar.</div>
      </div>
      ${o.delivery_zone_name?`<div class="data-row"><span>Zona</span><strong>${escapeHtml(o.delivery_zone_name)}</strong></div>`:""}
      <div class="data-block"><div class="label">Dirección</div><div class="value">${escapeHtml(address)}</div></div>
      <div class="data-block"><div class="label">Referencia</div><div class="value">${escapeHtml(reference)}</div></div>
      ${qrSrc?`<img class="qr" src="${qrSrc}" alt="QR Google Maps"><div class="qr-note">Escanea para abrir la ubicación en Google Maps.</div>`:""}
      <div class="data-block"><div class="label">Teléfono del cliente</div><div class="value">${escapeHtml(customerPhone||"Sin teléfono")}</div></div>
      <div class="data-block"><div class="label">Contacto PasteHot</div><div class="value">${escapeHtml(businessPhone||"Sin teléfono configurado")}</div></div>
      ${o.delivery_provider?`<div class="data-row"><span>Reparto</span><strong>${escapeHtml(o.delivery_provider)}</strong></div>`:""}
    `:"";

    popup.document.open();
    popup.document.write(`<!DOCTYPE html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket ${escapeHtml(o.order_code||"")}</title><style>
      @page{size:58mm auto;margin:0}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;width:58mm;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
      body{font-size:9px;line-height:1.28}
      .ticket{width:58mm;padding:2.5mm 2mm 4mm;margin:0 auto}
      .brand-logo{display:block;width:36mm;height:auto;margin:0 auto 1.5mm}
      .brand{text-align:center;font-size:14px;font-weight:900;line-height:1.05;margin-top:.2mm}
      .registered{font-size:5px;vertical-align:super;line-height:0;margin-left:.4px}
      .subtitle{text-align:center;font-size:9px;font-weight:900;margin-top:.7mm;letter-spacing:.4px}
      .order-code{text-align:center;font-size:11.5px;font-weight:900;line-height:1.12;margin:1.8mm 0 .7mm;overflow-wrap:anywhere}
      .date{text-align:center;font-size:8px;margin-bottom:1.8mm}
      .rule{border-top:1px dashed #000;margin:2mm 0}
      .label{font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.2px;margin-bottom:.4mm}
      .value{font-size:9.5px;font-weight:800;overflow-wrap:anywhere}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:1.6mm 2.4mm}
      .meta-line{grid-column:1/-1;display:flex;justify-content:space-between;align-items:baseline;gap:2mm;padding-top:1.2mm;border-top:1px dotted #aaa}
      .meta-line .label{margin:0}.meta-line .value{text-align:right}
      .item{display:grid;grid-template-columns:1fr auto;gap:1.5mm;align-items:start;padding:1.2mm 0;border-bottom:1px dotted #999}
      .item-name{min-width:0;overflow-wrap:anywhere}.item-name small{display:block;font-size:7.5px;font-weight:400;margin-top:.4mm}.item-total{white-space:nowrap;font-size:9px}
      .totals{display:grid;gap:1mm}.total-row{display:flex;justify-content:space-between;gap:1.5mm}.grand{font-size:13px;font-weight:900;border-top:1.5px solid #000;padding-top:1.6mm;margin-top:.8mm}
      .notes{margin-top:2mm;padding:1.5mm;border:1px solid #000;overflow-wrap:anywhere}.notes strong{display:block;font-size:7px;margin-bottom:.7mm}
      .delivery-title{text-align:center;font-size:9px;font-weight:900;letter-spacing:.5px;margin-bottom:1.5mm}
      .verify{border:2px solid #000;border-radius:1.5mm;padding:2mm;text-align:center;margin:1.6mm 0}
      .verify-label{font-size:7px;font-weight:900;text-transform:uppercase}.verify-code{font-size:21px;font-weight:950;letter-spacing:1.5px;margin:.6mm 0}.verify-note{font-size:7px;line-height:1.3}
      .data-block{margin:1.6mm 0}.data-row{display:flex;justify-content:space-between;gap:2mm;padding:1.2mm 0;border-bottom:1px dotted #aaa;font-size:8.5px}.data-row strong{text-align:right;overflow-wrap:anywhere}
      .qr{display:block;width:31mm;height:31mm;object-fit:contain;margin:2mm auto .8mm}.qr-note{text-align:center;font-size:7.5px;font-weight:800;margin-bottom:1.5mm}
      .footer{text-align:center;font-size:6.8px;line-height:1.3;margin-top:2mm}.website{font-size:9px;font-weight:900;margin:1.5mm 0}.legal{margin-top:1.5mm}.copyright{font-size:6.2px;margin-top:1.5mm}
      @media print{html,body{width:58mm}.ticket{page-break-after:auto}}
    </style></head><body><main class="ticket">
      ${options.includeLogo===false?'':'<img class="brand-logo" src="ticket-logo.png" alt="Logo PasteHot">'}
      <div class="subtitle">TICKET DE COMPRA</div>
      <div class="order-code">FOLIO ${escapeHtml(o.order_code||String(o.id||"").slice(0,8))}</div>
      <div class="date">${escapeHtml(ticketDate(o.created_at))}</div>
      <div class="rule"></div>
      <div class="meta">
        <div><div class="label">Cliente</div><div class="value">${escapeHtml(firstName)}</div></div>
        <div><div class="label">Teléfono</div><div class="value">${escapeHtml(customerPhone||"Sin teléfono")}</div></div>
        <div class="meta-line"><div class="label">Modalidad</div><div class="value">${escapeHtml(ticketDeliveryLabel(o.delivery_type))}</div></div>
        <div class="meta-line"><div class="label">Pago</div><div class="value">${escapeHtml(ticketPaymentLabel(o.payment_method))}</div></div>
      </div>
      <div class="rule"></div>
      <div>${itemRows||'<div style="text-align:center">Sin productos registrados.</div>'}</div>
      <div class="rule"></div>
      <div class="totals">
        <div class="total-row"><span>Subtotal</span><strong>${formatMoney(o.subtotal)}</strong></div>
        ${isDelivery&&rain>0?`<div class="total-row"><span>Tarifa base de envío</span><strong>${formatMoney(o.delivery_base_fee)}</strong></div><div class="total-row"><span>Recargo por lluvia</span><strong>${formatMoney(rain)}</strong></div>`:""}
        <div class="total-row"><span>Envío</span><strong>${formatMoney(o.delivery_fee)}</strong></div>
        <div class="total-row grand"><span>TOTAL</span><span>${formatMoney(o.total)}</span></div>
      </div>
      ${notes}
      ${deliveryBlock}
      <div class="rule"></div>
      <div class="footer"><div class="thanks">Gracias por tu compra</div><div class="website">www.pastehot.com</div><div class="copyright">© 2026 PasteHot<span class="registered">®</span> es una marca registrada. Todos los derechos reservados.</div></div>
    </main>${options.print===false?'':`<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));window.addEventListener('afterprint',()=>window.close());</script>`}</body></html>`);
    popup.document.close();
  };

  if(!hasLocation||typeof QRCode!=="function"){writeTicket("");return}
  const host=document.createElement("div");
  host.style.position="fixed";host.style.left="-9999px";
  document.body.appendChild(host);
  try{new QRCode(host,{text:mapsDirectionsUrl(o.delivery_lat,o.delivery_lng),width:200,height:200})}
  catch{host.remove();writeTicket("");return}
  setTimeout(()=>{
    const qrSrc=host.querySelector("img")?.src||host.querySelector("canvas")?.toDataURL("image/png")||"";
    host.remove();
    writeTicket(qrSrc);
  },80);
}

function mapsPointUrl(lat,lng){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`}
function mapsDirectionsUrl(lat,lng){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=driving`}
