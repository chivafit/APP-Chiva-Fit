function bindNavigation(){
  document.addEventListener("click", (e)=>{
    const el = e.target && e.target.closest ? e.target.closest("[data-page]") : null;
    if(!el) return;
    const page = String(el.dataset.page || "").trim();
    if(!page) return;
    const fn = window.showPage;
    if(typeof fn === "function") fn(page);
  });
}

document.addEventListener("DOMContentLoaded", ()=>{
  bindNavigation();
});

