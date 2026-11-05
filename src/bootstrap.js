// Only the authenticated backend selects business mode. Authorization always remains server-side.
if(document.querySelector('meta[name="qingbao-mode"]')?.content==='business'){
 const {mountBusiness}=await import('./business/ui.js');mountBusiness();
}else{await import('./main.js');}
